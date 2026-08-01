/**
 * GA SHIP-BLOCKER validation — the two recovery paths the 24-hour soak can
 * NEVER exercise, proven deterministically in seconds.
 *
 * Why this file exists
 * --------------------
 * The threads-soak runs for hours but its harness PRE-KILLS any competing
 * bridge before it starts (so the soak always begins uncontended) and it never
 * drives colliding relay identities. As a result, two code paths that the whole
 * hardening effort targeted have ZERO telemetry — they have literally never
 * fired in any soak:
 *
 *   #1  Graceful multi-bridge contention (the EADDRINUSE / "port already held"
 *       ship-blocker). When a second bridge races for a port another bridge
 *       already owns, the loser must bow out WITHOUT crashing and WITHOUT
 *       touching the winner's lock file — emitting bridge.lifecycle.port_in_use
 *       (EADDRINUSE) or bridge.lifecycle.listen_timeout (the Windows
 *       listen()-hangs case). Neither event has ever appeared in production
 *       telemetry, so the fix shipped UNVALIDATED.
 *
 *   #3  Relay-identity collision CONVERGENCE. When several relays claim the same
 *       browserId, the bridge resolves the winner by a strict total order on
 *       (gen, lifeUuid) — higher supersedes, exact tie is idempotent, lower is
 *       rejected with a TERMINAL 4002 so the loser stops re-challenging and the
 *       storm converges in one cycle (bounded `replaced`, no flapping). The
 *       converged events (relay_superseded / relay_rejected_lower_identity /
 *       relay_reconnect_idempotent) have never fired on the candidate build.
 *
 * Both tests run the ACTUAL exported startServer() (same code the shipped binary
 * runs) in real child processes on isolated ephemeral ports, with the lock file
 * + NDJSON logs redirected to a throwaway install dir. They then assert against
 * the structured bridge.log — i.e. they prove the exact telemetry the soak was
 * missing actually gets produced. No Chrome, no Claude, no 24-hour wait.
 *
 *   npx playwright test tests/e2e/ga-blockers.spec.ts
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';

const harness = path.resolve(__dirname, 'helpers/start-bridge.mjs');

// ── Shared harness helpers (mirrors connection-resilience.spec.ts) ──────────

/** Ask the OS for an ephemeral 127.0.0.1 port (listen on 0 → kernel-assigned). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
        const port = addr.port;
        s.close(() => resolve(port));
      } else {
        s.close();
        reject(new Error('failed to claim ephemeral port'));
      }
    });
  });
}

function makeLocalAppData(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ah-gablock-'));
  mkdirSync(path.join(root, 'agenthub'), { recursive: true });
  return root;
}
const installDirOf = (lad: string): string => path.join(lad, 'agenthub');
const lockPath = (lad: string): string => path.join(installDirOf(lad), 'server.lock');
const bridgeLogPath = (lad: string): string => path.join(installDirOf(lad), 'logs', 'bridge.log');

function spawnBridge(port: number, lad: string): ChildProcess {
  // stdin must be a 'pipe' (kept open), NOT 'ignore': startServer attaches an
  // MCP reader to stdin and an 'ignore'd stdin hits immediate EOF, tearing the
  // bridge down. The shipped bridge is launched with an open stdin too.
  return spawn(process.execPath, [harness], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AGENTHUB_TEST_PORT: String(port),
      LOCALAPPDATA: lad,
      AGENTHUB_INSTALL_DIR: installDirOf(lad),
    },
  });
}

interface LogRec { event?: string; pid?: number | null; browserId?: string; lvl?: string; [k: string]: unknown }

/** Read + parse the bridge's NDJSON log, tolerant of a torn final/interleaved line. */
function readLogEvents(logFile: string): LogRec[] {
  if (!existsSync(logFile)) return [];
  const out: LogRec[] = [];
  for (const line of readFileSync(logFile, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as LogRec); } catch { /* skip torn line */ }
  }
  return out;
}

/** Connect a real WS and resolve the server_info frame; null on failure. */
function probeServerInfo(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?browserId=ga-readiness-${Math.random().toString(36).slice(2)}`);
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

function waitExit(child: ChildProcess, timeoutMs: number): Promise<number | null | 'TIMEOUT'> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const t = setTimeout(() => resolve('TIMEOUT'), timeoutMs);
    child.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });
}

// ── Relay client modelling the extension's canonical (role=relay) socket ────

interface Relay {
  ws: WebSocket;
  closeCode?: number;
  closed: boolean;
  closedPromise: Promise<number>;
  serverInfo: Promise<void>;
}

/**
 * Open a canonical relay for `browserId` carrying identity (gen, lifeUuid).
 * Build the query string by hand (not URLSearchParams) so the raw lifeUuid
 * bytes the bridge compares are exactly what we sent — matching the extension
 * and the existing resilience specs. Auto-pongs server_ping so the periodic
 * liveness sweep never reaps our incumbent mid-test.
 */
function openRelay(
  port: number,
  browserId: string,
  opts: { role?: boolean; gen?: number | null; lifeUuid?: string } = {},
): Relay {
  const { role = true, gen = null, lifeUuid = '' } = opts;
  let url = `ws://127.0.0.1:${port}?browserId=${browserId}`;
  if (role) url += '&role=relay';
  if (gen !== null) url += `&gen=${gen}`;
  if (lifeUuid) url += `&lifeUuid=${lifeUuid}`;

  const ws = new WebSocket(url);
  const r: Relay = { ws, closed: false, closedPromise: undefined as never, serverInfo: undefined as never };

  let resolveClose!: (code: number) => void;
  r.closedPromise = new Promise<number>((res) => { resolveClose = res; });
  let resolveInfo!: () => void;
  let rejectInfo!: (e: Error) => void;
  r.serverInfo = new Promise<void>((res, rej) => { resolveInfo = res; rejectInfo = rej; });
  // Relays we EXPECT to be rejected (lower identity) never receive server_info;
  // their serverInfo promise rejects on close and is never awaited. Attach a
  // no-op catch so that expected rejection isn't reported as an unhandled one.
  void r.serverInfo.catch(() => {});

  ws.on('message', (d) => {
    try {
      const m = JSON.parse(String(d));
      if (m.type === 'server_ping') { ws.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() })); return; }
      if (m.type === 'server_info') resolveInfo();
    } catch { /* ignore */ }
  });
  ws.on('close', (code) => { r.closed = true; r.closeCode = code; resolveClose(code); rejectInfo(new Error(`closed ${code} before server_info`)); });
  ws.on('error', () => { /* close fires next */ });
  return r;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${label}`)), ms)),
  ]);
}

// ───────────────────────────────────────────────────────────────────────────

test.describe('GA ship-blocker validation (real bridge processes)', () => {
  test('ship-blocker #1: a 2nd bridge contending for a held port bows out gracefully (port_in_use / listen_timeout), never crashes, never touches the winner’s lock', async () => {
    const lad = makeLocalAppData();
    const port = await freePort();
    const winner = spawnBridge(port, lad);
    let loser: ChildProcess | undefined;
    try {
      // Winner takes the port and writes its lock (only on 'listening').
      const info = await waitForServerInfo(port);
      await expect.poll(() => existsSync(lockPath(lad)), { timeout: 5000 }).toBe(true);
      const winnerLock = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(winnerLock.pid, 'winner owns the lock').toBe(winner.pid);

      // CONTENTION: spawn a 2nd bridge on the SAME port + SAME install dir,
      // WITHOUT pre-killing the incumbent. This is precisely the start the soak
      // harness engineers away. The loser must exit on its own (0) via the
      // EADDRINUSE handler or the listen watchdog — never linger, never crash.
      loser = spawnBridge(port, lad);
      const loserExit = await waitExit(loser, 12_000);
      expect(loserExit, 'loser must exit, not linger as a zombie').not.toBe('TIMEOUT');
      expect(loserExit, 'loser must exit cleanly (process.exit(0))').toBe(0);

      // THE TELEMETRY THE SOAK NEVER PRODUCED: the loser emitted a graceful
      // bow-out event. Accept either — EADDRINUSE (posix) or the listen-hang
      // watchdog (Windows). Attribute strictly by the loser's PID (winner +
      // loser share one bridge.log).
      await expect
        .poll(() => {
          const ev = readLogEvents(bridgeLogPath(lad));
          return ev.some((e) => e.pid === loser!.pid
            && (e.event === 'bridge.lifecycle.port_in_use' || e.event === 'bridge.lifecycle.listen_timeout'));
        }, { timeout: 5000, message: 'loser must log a graceful port-contention bow-out' })
        .toBe(true);

      const events = readLogEvents(bridgeLogPath(lad));
      // The loser must NOT have crashed nor hit a hard listen_failed.
      const loserBad = events.filter((e) => e.pid === loser!.pid
        && (e.event === 'bridge.lifecycle.uncaught' || e.event === 'bridge.lifecycle.listen_failed'));
      expect(loserBad, `loser must not crash: ${JSON.stringify(loserBad)}`).toEqual([]);

      // Incumbent untouched: lock still the winner's PID (loser never wrote /
      // clobbered / deleted it), winner never crashed, and it is STILL serving.
      expect(existsSync(lockPath(lad)), 'lock must survive').toBe(true);
      const after = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(after.pid, 'lock still owned by the winner').toBe(winner.pid);
      const winnerCrash = events.filter((e) => e.pid === winner.pid && e.event === 'bridge.lifecycle.uncaught');
      expect(winnerCrash, 'incumbent must not crash').toEqual([]);
      const stillUp = await waitForServerInfo(port);
      expect(stillUp.pid, 'winner still owns the port after the contention').toBe(info.pid);
      expect(stillUp.pid).toBe(winner.pid);
    } finally {
      loser?.kill();
      winner.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });

  test('ship-blocker #3: relay-id collisions resolve by total order and the storm CONVERGES (superseded / rejected / idempotent fire; replaced stays bounded; zero uncaught)', async () => {
    const lad = makeLocalAppData();
    const port = await freePort();
    const bridge = spawnBridge(port, lad);
    const all: Relay[] = [];
    const id = 'chrome:ga-collision';
    try {
      await waitForServerInfo(port);

      // 1. Incumbent relay, gen=1000.
      const r1 = openRelay(port, id, { gen: 1000, lifeUuid: 'life-A' }); all.push(r1);
      await withTimeout(r1.serverInfo, 5000, 'r1 server_info');

      // 2. Strictly-HIGHER gen=2000 → supersede. Newcomer accepted, r1 closed,
      //    exactly one `replaced` (this is the only churn in the whole test).
      const r2 = openRelay(port, id, { gen: 2000, lifeUuid: 'life-B' }); all.push(r2);
      await withTimeout(r2.serverInfo, 5000, 'r2 server_info (accepted as higher identity)');
      await withTimeout(r1.closedPromise, 4000, 'r1 superseded/closed');
      expect(r2.ws.readyState, 'higher-identity relay is the live incumbent').toBe(WebSocket.OPEN);

      // 3. Strictly-LOWER gen=500 vs the gen=2000 incumbent → TERMINAL 4002,
      //    incumbent preserved. (The 4002 is what makes the storm converge: the
      //    loser treats it as terminal and stops re-challenging.)
      const r3 = openRelay(port, id, { gen: 500, lifeUuid: 'life-C' }); all.push(r3);
      expect(await withTimeout(r3.closedPromise, 5000, 'r3 rejected'), 'lower identity rejected with 4002').toBe(4002);
      expect(r2.ws.readyState, 'incumbent survives a lower challenger').toBe(WebSocket.OPEN);

      // 4. EXACT TIE (same gen+lifeUuid as the incumbent) → idempotent accept:
      //    server_info, NOT a 4002, and crucially NOT counted as churn (no
      //    `replaced`). The same SW life reopened its own socket.
      const r4 = openRelay(port, id, { gen: 2000, lifeUuid: 'life-B' }); all.push(r4);
      await withTimeout(r4.serverInfo, 5000, 'r4 idempotent accept');
      expect(r4.closeCode, 'idempotent reconnect must NOT be 4002-rejected').not.toBe(4002);
      // r4 is now the incumbent (gen=2000). (The prior r2 socket is terminated by
      // the idempotent swap — that is expected and is NOT churn.)

      // 5. STORM: a burst of lower-gen challengers all racing the gen=2000
      //    incumbent. Every one must get a terminal 4002, the incumbent must
      //    never flap, and — the convergence proof — NO further `replaced`.
      const STORM = 12;
      const stormRelays = Array.from({ length: STORM }, (_, i) =>
        openRelay(port, id, { gen: 100 + i, lifeUuid: `storm-${i}` }));
      all.push(...stormRelays);
      const codes = await withTimeout(
        Promise.all(stormRelays.map((s) => s.closedPromise)), 15_000, 'storm challengers close');
      expect(codes.every((c) => c === 4002), `every lower-gen challenger must be terminally rejected, got ${JSON.stringify(codes)}`).toBe(true);
      expect(r4.ws.readyState, 'incumbent survives the entire storm').toBe(WebSocket.OPEN);

      // ── Assert the telemetry the soak never produced + convergence ──────────
      const events = readLogEvents(bridgeLogPath(lad));
      const n = (event: string) => events.filter((e) => e.event === event && e.browserId === id).length;

      expect(n('bridge.browser.relay_superseded'), 'relay_superseded must fire (higher identity won)').toBeGreaterThanOrEqual(1);
      expect(n('bridge.browser.relay_rejected_lower_identity'), 'every lower challenger logs a terminal rejection').toBeGreaterThanOrEqual(STORM + 1);
      expect(n('bridge.browser.relay_reconnect_idempotent'), 'idempotent same-life reconnect must fire').toBeGreaterThanOrEqual(1);

      // CONVERGENCE: despite 1 supersede + 1 idempotent swap + 13 rejected
      // challengers, the ONLY churn-counted replacement is gen1000→gen2000.
      // A non-converged build would flap on every challenger (replaced ≫ 1).
      expect(n('bridge.browser.replaced'), 'replaced must stay bounded at 1 — no flapping storm').toBe(1);

      // And the bridge never crashed under the collision storm.
      const uncaught = events.filter((e) => e.event === 'bridge.lifecycle.uncaught');
      expect(uncaught, `bridge must not crash during the storm: ${JSON.stringify(uncaught)}`).toEqual([]);
    } finally {
      for (const r of all) { try { r.ws.close(); } catch { /* */ } }
      bridge.kill();
      rmSync(lad, { recursive: true, force: true });
    }
  });
});
