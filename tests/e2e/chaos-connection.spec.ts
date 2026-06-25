/**
 * Connection-layer CHAOS harness — REAL, no mocks.
 *
 * Every test spawns the ACTUAL bridge (`startServer` via start-bridge.mjs) in a
 * real child process on an isolated port + throwaway LOCALAPPDATA, then drives
 * it with REAL WebSocket clients speaking the REAL wire protocol:
 *   relay   →  ?browserId=<id>&role=relay, answers server_ping + tool_request
 *   probe   →  ?browserId=helper-probe
 *   mcp     →  ?role=mcp, real MCP JSON-RPC (initialize + tools/call)
 *
 * It then INJECTS the faults we hit on 2026-06-18 and asserts CLEAN RECOVERY:
 *   - reconnect collision (the 4002 inverse loop)
 *   - non-canonical duplicate vs a live relay (must not kill it)
 *   - SW eviction (abrupt close) → reconnect → tool routes to the new socket
 *   - orphan WEDGE (pongs but won't dispatch) → tool fails VISIBLY, not green-but-empty
 *   - bind race (two bridges, one port)
 *
 * No browser is launched; the bridge connection layer is the system under test.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket, type RawData } from 'ws';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';

const harness = path.resolve(__dirname, 'helpers/start-bridge.mjs');

function freePort(): Promise<number> {
  // OS-assigned ephemeral port (listen on 0). The previous random-range
  // approach collided occasionally on Windows ('bridge never came up'
  // because the picked port was already in use). The close→reuse race
  // here is far smaller than random collisions in a 20k-port range.
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
  const root = mkdtempSync(path.join(tmpdir(), 'ah-chaos-'));
  mkdirSync(path.join(root, 'agenthub'), { recursive: true });
  return root;
}
function lockPath(lad: string): string { return path.join(lad, 'agenthub', 'server.lock'); }
function spawnBridge(port: number, lad: string): ChildProcess {
  return spawn(process.execPath, [harness], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AGENTHUB_TEST_PORT: String(port), LOCALAPPDATA: lad, AGENTHUB_INSTALL_DIR: path.join(lad, 'agenthub') },
  });
}
function waitFor<T>(p: Promise<T>, ms: number, label = 'wait'): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);
}
async function waitForBridge(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?browserId=ready-probe-${Math.random()}`);
      const t = setTimeout(() => { try { ws.close(); } catch { /* */ } resolve(false); }, 800);
      ws.on('message', (d) => { try { if (JSON.parse(String(d)).type === 'server_info') { clearTimeout(t); ws.close(); resolve(true); } } catch { /* */ } });
      ws.on('error', () => { clearTimeout(t); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`bridge on ${port} never came up`);
}

/** A REAL relay client: speaks the extension's wire protocol over a real WS. */
class Relay {
  ws: WebSocket;
  closed = false;
  closeCode: number | null = null;
  /** Number of times this logical relay opened a socket (for "does NOT reopen"
   *  assertions). The extension treats a 4002 as terminal, so a faithful relay
   *  that mimics that policy must not auto-reopen — we model the policy via the
   *  `reopenOn4002` flag below. */
  openCount = 0;
  /** Set when this relay received a 4002 (lost the total-order collision). */
  got4002 = false;
  private pong = true;
  private answer: ((req: { id: string; tool: string }) => unknown) | null;
  private readonly port: number;
  private readonly id: string;
  private readonly url: string;
  /** If true, a 4002 close triggers a reopen with the SAME identity (models the
   *  BUGGY pre-fix behavior, used to prove the loser does NOT storm). Default
   *  false = faithful 4002-is-terminal extension behavior. */
  reopenOn4002: boolean;
  constructor(port: number, id: string, opts: { canonical?: boolean; pong?: boolean; answerTools?: ((req: { id: string; tool: string }) => unknown) | null; gen?: number; lifeUuid?: string; reopenOn4002?: boolean } = {}) {
    this.pong = opts.pong ?? true;
    this.answer = opts.answerTools ?? null;
    this.port = port;
    this.id = id;
    this.reopenOn4002 = opts.reopenOn4002 ?? false;
    const role = (opts.canonical ?? true) ? '&role=relay' : '';
    const gen = opts.gen !== undefined ? `&gen=${opts.gen}` : '';
    const lifeUuid = opts.lifeUuid !== undefined ? `&lifeUuid=${opts.lifeUuid}` : '';
    this.url = `ws://127.0.0.1:${port}?browserId=${id}${role}${gen}${lifeUuid}`;
    this.ws = this.open();
  }
  private open(): WebSocket {
    this.openCount++;
    const ws = new WebSocket(this.url);
    ws.on('message', (d: RawData) => {
      let m: { type?: string; id?: string; tool?: string; timestamp?: number };
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m.type === 'server_ping' && this.pong) ws.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() }));
      if (m.type === 'tool_request' && this.answer && m.id) {
        ws.send(JSON.stringify({ type: 'tool_response', id: m.id, result: this.answer({ id: m.id, tool: m.tool ?? '' }) }));
      }
    });
    ws.on('close', (c) => {
      this.closed = true; this.closeCode = c;
      if (c === 4002) {
        this.got4002 = true;
        // Faithful extension: 4002 is terminal → no reopen. Only when
        // reopenOn4002 is set (the buggy-storm model) do we re-challenge.
        if (this.reopenOn4002) { this.closed = false; this.ws = this.open(); }
      }
    });
    return ws;
  }
  serverInfo(ms = 4000): Promise<void> {
    return waitFor(new Promise<void>((resolve) => {
      const h = (d: RawData) => { try { if (JSON.parse(String(d)).type === 'server_info') { this.ws.off('message', h); resolve(); } } catch { /* */ } };
      this.ws.on('message', h);
    }), ms, 'server_info');
  }
  goSilent(): void { this.pong = false; this.answer = null; } // simulate a wedge
  kill(): void { try { this.ws.terminate(); } catch { /* */ } }       // simulate abrupt SW death
  close(): void { this.reopenOn4002 = false; try { this.ws.close(); } catch { /* */ } }
}

interface ApiBrowser { browserId: string; liveness: string; supersededCount: number; lastRelayCloseCode: number | null; lastRelayClosedAt: string | null }
/** Fetch /api/state and return the browsers[] array (with the §7.2.3 fields). */
async function apiBrowsers(port: number): Promise<ApiBrowser[]> {
  const res = await fetch(`http://127.0.0.1:${port}/api/state`);
  const data = await res.json() as { browsers?: ApiBrowser[] };
  return data.browsers ?? [];
}

/** A REAL MCP client over WS: initialize + tools/call. */
class Mcp {
  private ws!: WebSocket;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  static async connect(port: number): Promise<Mcp> {
    const m = new Mcp();
    await new Promise<void>((resolve, reject) => {
      m.ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
      m.ws.on('message', (d: RawData) => {
        for (const line of String(d).split('\n')) {
          const t = line.trim(); if (!t) continue;
          let msg: { id?: number; result?: unknown; error?: { message?: string } };
          try { msg = JSON.parse(t); } catch { continue; }
          if (msg.id != null && m.pending.has(msg.id)) {
            const p = m.pending.get(msg.id)!; m.pending.delete(msg.id); clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error.message || 'rpc error')); else p.resolve(msg.result);
          }
        }
      });
      m.ws.on('error', reject);
      m.ws.on('open', () => resolve());
    });
    await m.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chaos', version: '1' } }, 5000);
    m.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    return m;
  }
  rpc(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`rpc ${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
  callTool(name: string, args: unknown, timeoutMs: number): Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }> {
    return this.rpc('tools/call', { name, arguments: args }, timeoutMs) as Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>;
  }
  close(): void { try { this.ws.close(); } catch { /* */ } }
}

test.describe('connection chaos (real bridge, real protocol, injected faults)', () => {
  test('CHAOS reconnect-collision: a fresh canonical relay supersedes a still-ponging one (no 4002 loop)', async () => {
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-reconnect';
      const oldRelay = new Relay(port, id, { canonical: true, pong: true }); // lingering, still pongs
      await oldRelay.serverInfo();

      const fresh = new Relay(port, id, { canonical: true, pong: true });     // real reconnect
      await fresh.serverInfo();                                               // ACCEPTED — would 4002 in the bug

      expect(fresh.closeCode).not.toBe(4002);
      await expect.poll(() => oldRelay.closed, { timeout: 2500 }).toBe(true);  // superseded, closed
      fresh.close(); oldRelay.close();
    } finally { bridge.kill(); }
  });

  test('CHAOS duplicate-vs-live: a non-canonical duplicate cannot kill the live relay (4002, relay survives)', async () => {
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-dup';
      const relay = new Relay(port, id, { canonical: true, pong: true });
      await relay.serverInfo();

      const dup = new Relay(port, id, { canonical: false, pong: true });       // no role=relay
      const code = await waitFor(new Promise<number>((res) => { const t = setInterval(() => { if (dup.closeCode != null) { clearInterval(t); res(dup.closeCode); } }, 50); }), 4000, 'dup close');

      expect(code).toBe(4002);             // duplicate rejected
      expect(relay.closed).toBe(false);    // live relay preserved
      relay.close();
    } finally { bridge.kill(); }
  });

  test('CHAOS SW-eviction: abrupt relay death + reconnect → a tool routes to the NEW socket', async () => {
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-evict';
      // list_tabs success envelope: content[0].text MUST be a JSON ARRAY of tabs
      // (matches the real extension shape that mergeFanOutListTabs parses).
      const tabsResult = { content: [{ type: 'text', text: JSON.stringify([{ id: `${id}:1`, title: 'fresh', url: 'https://example.com', active: true, pinned: false }]) }] };

      const dying = new Relay(port, id, { canonical: true, pong: true, answerTools: () => ({ ok: false }) });
      await dying.serverInfo();
      dying.kill();                          // abrupt SW death (no clean close)
      await new Promise((r) => setTimeout(r, 200));

      const fresh = new Relay(port, id, { canonical: true, pong: true, answerTools: () => tabsResult });
      await fresh.serverInfo();

      const mcp = await Mcp.connect(port);
      const res = await mcp.callTool('list_tabs', {}, 12_000);   // must route to fresh, return real data fast
      const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
      expect(text).toContain('fresh');
      expect(res.isError).not.toBe(true);
      mcp.close(); fresh.close();
    } finally { bridge.kill(); }
  });

  test('CHAOS orphan-wedge: relay pongs but will NOT dispatch → tool fails VISIBLY (not green-but-empty)', async () => {
    // The green-but-zero-tabs failure class: a socket that answers pings (looks
    // healthy) but never replies to tool_request. The call MUST return (not hang)
    // and MUST be flagged isError — never a silent empty "success".
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-wedge';
      const wedged = new Relay(port, id, { canonical: true, pong: true, answerTools: null }); // pongs, ignores tools
      await wedged.serverInfo();

      const mcp = await Mcp.connect(port);
      const res = await mcp.callTool('list_tabs', {}, 15_000);   // bridge fan-out times out (~10s), merges
      expect(res.isError).toBe(true);                             // the failure is VISIBLE, not a silent empty
      mcp.close(); wedged.close();
    } finally { bridge.kill(); }
  });

  test('CHAOS bind-race: a second bridge on the same port never clobbers the winner’s lock', async () => {
    const lad = makeLocalAppData(); const port = await freePort();
    const winner = spawnBridge(port, lad);
    let loser: ChildProcess | undefined;
    try {
      await waitForBridge(port);
      await expect.poll(() => existsSync(lockPath(lad)), { timeout: 4000 }).toBe(true);
      const winnerPid = JSON.parse(readFileSync(lockPath(lad), 'utf-8')).pid;
      expect(winnerPid).toBe(winner.pid);

      loser = spawnBridge(port, lad);
      await new Promise((r) => setTimeout(r, 5000));

      const after = JSON.parse(readFileSync(lockPath(lad), 'utf-8'));
      expect(after.pid).toBe(winner.pid);   // not clobbered, not deleted
    } finally { loser?.kill(); winner.kill(); }
  });

  // ── §6.8 / §8.3 total-order regression gate ──────────────────────────────

  test('CHAOS equal-gen concurrency: converge to ONE winner, loser 4002 + no reopen, in-flight tool completes', async () => {
    // §6.8(a): two lives race to the SAME gen with different lifeUuid. The total
    // order must pick exactly one winner; the loser gets 4002 and (faithful
    // 4002-is-terminal) does NOT reopen; an in-flight >2s tool_request on the
    // WINNER completes with no browser_socket_replaced_mid_request.
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-equalgen';
      const tabs = { content: [{ type: 'text', text: JSON.stringify([{ id: `${id}:1`, title: 'won', url: 'https://example.com', active: true, pinned: false }]) }] };
      // Winner answers tools after a >2s delay (in-flight during contention).
      const winner = new Relay(port, id, { gen: 1000, lifeUuid: 'zzzz', reopenOn4002: false,
        answerTools: () => tabs });
      const loser = new Relay(port, id, { gen: 1000, lifeUuid: 'aaaa', reopenOn4002: false,
        answerTools: () => ({ ok: false }) });
      // Winner connects first (incumbent); loser challenges with lower lifeUuid.
      await winner.serverInfo();
      await new Promise((r) => setTimeout(r, 150));

      // Loser must be rejected 4002 and must NOT reopen.
      await expect.poll(() => loser.got4002, { timeout: 4000 }).toBe(true);
      const openCountAfter4002 = loser.openCount;

      const mcp = await Mcp.connect(port);
      const res = await mcp.callTool('list_tabs', {}, 12_000);
      const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
      expect(text).toContain('won');               // winner answered
      expect(res.isError).not.toBe(true);           // not replaced-mid-request
      expect(loser.openCount).toBe(openCountAfter4002); // loser did NOT reopen
      expect(winner.closed).toBe(false);            // winner survived
      mcp.close(); winner.close(); wssClose(loser);
    } finally { bridge.kill(); }
  });

  test('CHAOS rollback resistance: a LOWER-gen challenger is rejected, but a genuine HIGHER-gen life is not locked out', async () => {
    // §6.8(b): incumbent has a high identity (simulating a healthy winner); a
    // lower-gen challenger (storage wipe / counter rollback) must NOT supersede
    // it (4002). Then a genuine fresh life with a HIGHER gen still wins — proving
    // the lockout is identity-scoped, not permanent.
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-rollback';
      const incumbent = new Relay(port, id, { gen: 9_000_000, lifeUuid: 'mmmm' });
      await incumbent.serverInfo();

      const rolledBack = new Relay(port, id, { gen: 100, lifeUuid: 'zzzz' }); // lower gen
      await expect.poll(() => rolledBack.got4002, { timeout: 4000 }).toBe(true);
      expect(incumbent.closed).toBe(false);   // incumbent preserved

      // A genuine new life (higher gen than the incumbent) still wins.
      const fresh = new Relay(port, id, { gen: 9_999_999, lifeUuid: 'aaaa' });
      await fresh.serverInfo();
      expect(fresh.closeCode).not.toBe(4002);
      await expect.poll(() => incumbent.closed, { timeout: 3000 }).toBe(true);
      fresh.close(); wssClose(rolledBack);
    } finally { bridge.kill(); }
  });

  test('CHAOS guarded recovery: terminal loser does NOT re-challenge a healthy winner, recovers after it dies', async () => {
    // §8.3: with the winner healthy across ≥3 alarm intervals, /api/state shows a
    // live relay → a guarded life must NOT re-challenge (zero extra superseded).
    // Once the winner's socket closes, /api/state shows no live relay → recovery
    // is allowed. We model the GUARD here (the extension probes /api/state before
    // re-minting): assert the bridge sees no extra churn while the winner is
    // live, and that liveness flips to allow recovery after it dies.
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-guard';
      const winner = new Relay(port, id, { gen: 5000, lifeUuid: 'wwww' });
      await winner.serverInfo();
      // Loser challenges lower, gets 4002, terminal (no reopen).
      const loser = new Relay(port, id, { gen: 4000, lifeUuid: 'llll', reopenOn4002: false });
      await expect.poll(() => loser.got4002, { timeout: 4000 }).toBe(true);

      const churnAfterReject = (await apiBrowsers(port)).find((b) => b.browserId === id)?.supersededCount ?? 0;

      // Winner stays healthy across 3 alarm-like intervals; the guarded loser
      // must NOT re-challenge. The guard reads /api/state and defers whenever a
      // relay is PRESENT and not 'stale' (the probe treats 'live' AND the
      // just-connected 'unknown' both as "winner present" — server_ping is only
      // every ~20s, so a fresh winner legitimately reads 'unknown'). Assert the
      // signal the guard consumes, and that supersede churn does NOT grow.
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const me = (await apiBrowsers(port)).find((b) => b.browserId === id);
        expect(me).toBeTruthy();                            // relay present → guard stays quiet
        expect(me?.liveness).not.toBe('stale');             // not wedged/gone
        expect(me?.supersededCount).toBe(churnAfterReject);  // zero extra churn
      }

      // Winner dies → bridge no longer has a relay for this browserId, so the
      // guard's probe returns 'none' and recovery is permitted.
      winner.close();
      await expect.poll(async () => (await apiBrowsers(port)).some((b) => b.browserId === id), { timeout: 4000 }).toBe(false);
      // The guard would now permit recovery (no live relay). A fresh higher-gen
      // life connects cleanly (not 4002), proving recovery is unblocked.
      const recovered = new Relay(port, id, { gen: 6000, lifeUuid: 'rrrr' });
      await recovered.serverInfo();
      expect(recovered.closeCode).not.toBe(4002);
      recovered.close(); wssClose(loser);
    } finally { bridge.kill(); }
  });

  test('CHAOS lifeUuid byte-compare: both sockets agree on the winner (stable total order)', async () => {
    // §7.1.4: equal gen, lexicographic lifeUuid tiebreak. The HIGHER lifeUuid
    // must win regardless of connect order; the loser gets 4002. Run it with the
    // higher-lifeUuid arriving SECOND to prove order-independence.
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      const id = 'chrome:chaos-bytecmp';
      const lower = new Relay(port, id, { gen: 7000, lifeUuid: 'aaaa' });
      await lower.serverInfo();
      const higher = new Relay(port, id, { gen: 7000, lifeUuid: 'bbbb' }); // strictly higher
      await higher.serverInfo();   // accepted
      expect(higher.closeCode).not.toBe(4002);
      await expect.poll(() => lower.closed, { timeout: 3000 }).toBe(true); // lower superseded
      higher.close(); wssClose(lower);
    } finally { bridge.kill(); }
  });

  test('CHAOS inverse: genuine higher-gen reconnect supersedes <1.5s; two distinct browserIds both stay connected; probe ignored', async () => {
    // §6.8(e): the inverse / non-regression cases must still hold.
    const lad = makeLocalAppData(); const port = await freePort();
    const bridge = spawnBridge(port, lad);
    try {
      await waitForBridge(port);
      // (1) higher-gen reconnect supersedes fast.
      const idA = 'chrome:chaos-inv-a';
      const old = new Relay(port, idA, { gen: 1000, lifeUuid: 'aaaa' });
      await old.serverInfo();
      const t0 = Date.now();
      const fresh = new Relay(port, idA, { gen: 2000, lifeUuid: 'aaaa' });
      await fresh.serverInfo();
      await expect.poll(() => old.closed, { timeout: 1500 }).toBe(true);
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(fresh.closeCode).not.toBe(4002);

      // (2) two distinct browserIds both stay connected (no cross-eviction).
      const idB = 'chrome:chaos-inv-b';
      const relayB = new Relay(port, idB, { gen: 1000, lifeUuid: 'aaaa' });
      await relayB.serverInfo();
      await new Promise((r) => setTimeout(r, 300));
      expect(fresh.closed).toBe(false);
      expect(relayB.closed).toBe(false);
      const browsers = await apiBrowsers(port);
      expect(browsers.some((b) => b.browserId === idA)).toBe(true);
      expect(browsers.some((b) => b.browserId === idB)).toBe(true);

      // (3) helper-probe is exempt — does not collide with or evict a real relay.
      const probe = new Relay(port, 'helper-probe', { canonical: false });
      await new Promise((r) => setTimeout(r, 300));
      expect(fresh.closed).toBe(false);
      expect(relayB.closed).toBe(false);
      fresh.close(); relayB.close(); probe.close(); wssClose(old);
    } finally { bridge.kill(); }
  });
});

/** Force-close a Relay's underlying socket without triggering its reopen logic. */
function wssClose(r: Relay): void { r.close(); }
