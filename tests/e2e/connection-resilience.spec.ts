/**
 * Real end-to-end connection-resilience tests.
 *
 * These spawn the ACTUAL bridge (the exported startServer, same code the
 * shipped binary runs) in real child processes on isolated ports, with the
 * lock file + logs redirected to a throwaway LOCALAPPDATA, and drive it over
 * real WebSockets. No mocks. They cover the two failures fixed on 2026-06-18:
 *
 *   Bug #1 — the bridge used to terminate a LIVE relay whenever a second
 *            socket arrived for the same browserId (a duplicate / stale-client
 *            health-probe), so tools timed out while the UI showed "connected".
 *            Fixed: prove the incumbent dead before replacing it.
 *
 *   Bug #2 — the bridge wrote its lock file BEFORE confirming it won the port
 *            bind, so a racing loser clobbered + deleted the winner's lock,
 *            leaving a running bridge with no lock → discovery churn. Fixed:
 *            write the lock only after 'listening'; never touch it on EADDRINUSE.
 *
 * No Chrome is launched (these don't use the page/context fixtures), and the
 * isolated LOCALAPPDATA means they never disturb the user's live 7483 bridge.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const harness = path.resolve(__dirname, 'helpers/start-bridge.mjs');

function freePort(): number {
  // High ephemeral range; collisions across tests are astronomically unlikely
  // and a clash just fails that one test loudly rather than silently passing.
  return 21000 + Math.floor(Math.random() * 20000);
}

function makeLocalAppData(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ah-e2e-'));
  mkdirSync(path.join(root, 'agenthub'), { recursive: true });
  return root;
}
function lockPath(localAppData: string): string {
  return path.join(localAppData, 'agenthub', 'server.lock');
}

function spawnBridge(port: number, localAppData: string): ChildProcess {
  // stdin must be a 'pipe' (kept open), NOT 'ignore': startServer attaches an
  // MCP reader to stdin, and an 'ignore'd stdin hits immediate EOF, which tears
  // the bridge down. The shipped bridge is launched with an open stdin too.
  return spawn(process.execPath, [harness], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AGENTHUB_TEST_PORT: String(port), LOCALAPPDATA: localAppData, AGENTHUB_INSTALL_DIR: path.join(localAppData, 'agenthub') },
  });
}

/** Connect a real WS and resolve the server_info frame; null on failure. */
function probeServerInfo(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?browserId=e2e-readiness-${Math.random().toString(36).slice(2)}`);
    const done = (v: Record<string, unknown> | null) => { try { ws.close(); } catch { /* */ } resolve(v); };
    const t = setTimeout(() => done(null), 1200);
    ws.on('message', (d) => {
      try { const m = JSON.parse(String(d)); if (m.type === 'server_info') { clearTimeout(t); done(m); } } catch { /* */ }
    });
    ws.on('error', () => { clearTimeout(t); done(null); });
  });
}

async function waitForServerInfo(port: number, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await probeServerInfo(port);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`bridge on ${port} never sent server_info within ${timeoutMs}ms`);
}

function onceServerInfo(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const h = (d: WebSocket.RawData) => {
      try { if (JSON.parse(String(d)).type === 'server_info') { ws.off('message', h); resolve(); } } catch { /* */ }
    };
    ws.on('message', h);
  });
}

test.describe('connection resilience (real bridge process)', () => {
  test('writes server.lock only after binding the port', async () => {
    const lad = makeLocalAppData();
    const port = freePort();
    const child = spawnBridge(port, lad);
    try {
      const info = await waitForServerInfo(port);
      expect(info.port).toBe(port);
      await expect.poll(() => existsSync(lockPath(lad)), { timeout: 4000 }).toBe(true);
      const lock = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(lock.pid).toBe(child.pid);
      expect(lock.port).toBe(port);
    } finally {
      child.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });

  test('bug #2: a second bridge racing the same port NEVER clobbers or deletes the winner’s lock', async () => {
    // The invariant that matters (and the actual regression): a bridge that
    // does NOT win the port bind must never touch the lock file. The old code
    // wrote the lock before confirming the bind, so the loser overwrote the
    // winner's PID and then deleted the lock on exit — leaving a running bridge
    // undiscoverable. The fix writes the lock only on 'listening'.
    //
    // On Windows a listen() against a busy port HANGS rather than emitting
    // EADDRINUSE, so the bridge has a listen watchdog (LISTEN_DEADLINE_MS) that
    // makes the loser exit instead of lingering as a zombie. We assert BOTH the
    // lock integrity (the core guarantee) and that the loser bows out.
    const lad = makeLocalAppData();
    const port = freePort();
    const winner = spawnBridge(port, lad);
    let loser: ChildProcess | undefined;
    try {
      const info = await waitForServerInfo(port);
      await expect.poll(() => existsSync(lockPath(lad)), { timeout: 4000 }).toBe(true);
      const winnerLock = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(winnerLock.pid).toBe(winner.pid);

      // Second bridge races the SAME port + lock dir. It must NOT touch the
      // lock and must exit on its own (via the listen watchdog, ~5s).
      loser = spawnBridge(port, lad);
      const loserExit = await new Promise<number | null>((resolve) => {
        const t = setTimeout(() => resolve(-1), 12_000); // -1 sentinel: never exited
        loser!.on('exit', (c) => { clearTimeout(t); resolve(c); });
      });
      expect(loserExit, 'loser should exit, not linger as a zombie').not.toBe(-1);

      // Lock still present, still the winner's PID — not clobbered, not deleted.
      expect(existsSync(lockPath(lad))).toBe(true);
      const after = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(after.pid).toBe(winner.pid);

      // And the winner is genuinely still serving on that port.
      const stillUp = await waitForServerInfo(port);
      expect(stillUp.pid).toBe(info.pid);
      expect(stillUp.pid).toBe(winner.pid);
    } finally {
      loser?.kill();
      winner.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });

  test('bug #1: a duplicate socket does NOT kill a LIVE relay (rejected with 4002)', async () => {
    const lad = makeLocalAppData();
    const port = freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForServerInfo(port);
      const id = 'chrome:e2e-live';

      // The "relay": stays connected and answers server_ping with server_pong,
      // so the bridge's liveness probe proves it alive.
      const relay = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
      relay.on('message', (d) => {
        try { if (JSON.parse(String(d)).type === 'server_ping') relay.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() })); } catch { /* */ }
      });
      let relayClosed = false;
      relay.on('close', () => { relayClosed = true; });
      await onceServerInfo(relay);

      // Duplicate connection for the SAME browserId.
      const dup = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
      const dupCloseCode = await new Promise<number>((resolve) => dup.on('close', (c) => resolve(c)));

      expect(dupCloseCode).toBe(4002);            // duplicate rejected...
      expect(relayClosed).toBe(false);            // ...and the live relay preserved
      expect(relay.readyState).toBe(WebSocket.OPEN);
      relay.close();
    } finally {
      bridge.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });

  test('inverse of the 4002 bug: a canonical relay (role=relay) SUPERSEDES a still-live incumbent', async () => {
    // The real client reconnecting (new SW life, role=relay) while a stale
    // socket still pongs must be ACCEPTED — not 4002-looped. Identity wins.
    const lad = makeLocalAppData();
    const port = freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForServerInfo(port);
      const id = 'chrome:e2e-reconnect';

      // Incumbent: a canonical relay that keeps answering pings (lingering).
      const old = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}&role=relay`);
      old.on('message', (d) => {
        try { if (JSON.parse(String(d)).type === 'server_ping') old.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() })); } catch { /* */ }
      });
      let oldClosed = false;
      old.on('close', () => { oldClosed = true; });
      await onceServerInfo(old);

      // Real client reconnects as a canonical relay for the same browserId.
      const fresh = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}&role=relay`);
      let fresh4002 = false;
      fresh.on('close', (c) => { if (c === 4002) fresh4002 = true; });

      await onceServerInfo(fresh);                  // ACCEPTED (server_info), not 4002

      expect(fresh.readyState).toBe(WebSocket.OPEN);
      expect(fresh4002).toBe(false);                // no 4002 loop
      await expect.poll(() => oldClosed, { timeout: 2000 }).toBe(true); // superseded
      fresh.close();
    } finally {
      bridge.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });

  test('bug #1: a DEAD/orphaned relay IS replaced by a reconnect', async () => {
    const lad = makeLocalAppData();
    const port = freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForServerInfo(port);
      const id = 'chrome:e2e-orphan';

      // Orphan relay: connected at the OS level but never answers server_ping
      // (simulates a wedged MV3 service worker).
      const orphan = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
      let orphanClosed = false;
      orphan.on('close', () => { orphanClosed = true; });
      await onceServerInfo(orphan);

      // Reconnect for the same browserId. After the orphan fails its liveness
      // probe (~1.5s) the newcomer is accepted (gets server_info) and the
      // orphan is terminated.
      const reconnect = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
      await onceServerInfo(reconnect);
      expect(reconnect.readyState).toBe(WebSocket.OPEN);

      await expect.poll(() => orphanClosed, { timeout: 3000 }).toBe(true);
      reconnect.close();
    } finally {
      bridge.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });
});
