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
  private pong = true;
  private answer: ((req: { id: string; tool: string }) => unknown) | null;
  constructor(port: number, id: string, opts: { canonical?: boolean; pong?: boolean; answerTools?: ((req: { id: string; tool: string }) => unknown) | null } = {}) {
    this.pong = opts.pong ?? true;
    this.answer = opts.answerTools ?? null;
    const role = (opts.canonical ?? true) ? '&role=relay' : '';
    this.ws = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}${role}`);
    this.ws.on('message', (d: RawData) => {
      let m: { type?: string; id?: string; tool?: string; timestamp?: number };
      try { m = JSON.parse(String(d)); } catch { return; }
      if (m.type === 'server_ping' && this.pong) this.ws.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() }));
      if (m.type === 'tool_request' && this.answer && m.id) {
        this.ws.send(JSON.stringify({ type: 'tool_response', id: m.id, result: this.answer({ id: m.id, tool: m.tool ?? '' }) }));
      }
    });
    this.ws.on('close', (c) => { this.closed = true; this.closeCode = c; });
  }
  serverInfo(ms = 4000): Promise<void> {
    return waitFor(new Promise<void>((resolve) => {
      const h = (d: RawData) => { try { if (JSON.parse(String(d)).type === 'server_info') { this.ws.off('message', h); resolve(); } } catch { /* */ } };
      this.ws.on('message', h);
    }), ms, 'server_info');
  }
  goSilent(): void { this.pong = false; this.answer = null; } // simulate a wedge
  kill(): void { try { this.ws.terminate(); } catch { /* */ } }       // simulate abrupt SW death
  close(): void { try { this.ws.close(); } catch { /* */ } }
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
});
