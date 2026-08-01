import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RelayCallbacks } from './relay-client';
import type { DiscoveryResult } from './service-discovery';
import { createConnectionManager } from './connection-manager';

// ── Fake relay-client ───────────────────────────────────────────────────────
// connection-manager imports `createRelay` directly (not injected), so the only
// seam is the module mock. Each createRelay() pushes a FakeRelay that records
// every connect(url) and exposes the captured callbacks so a test can drive the
// bridge-side events (onOpen / onClose / onServerInfo / onPong) deterministically.
interface FakeRelay {
  callbacks: RelayCallbacks;
  connectUrls: string[];
  connected: boolean;
  connecting: boolean;
  discarded: boolean;
  connect: (url: string) => void;
  disconnect: () => void;
  discard: () => void;
  send: (m: unknown) => void;
  sendPing: (t: number) => void;
  sendToolResponse: (id: string, r: unknown) => void;
  sendToolError: (id: string, e: { message: string; code: string }) => void;
  isConnected: () => boolean;
  isConnecting: () => boolean;
}

const { relays } = vi.hoisted(() => ({ relays: [] as FakeRelay[] }));

vi.mock('./relay-client', () => ({
  createRelay: (callbacks: RelayCallbacks): FakeRelay => {
    const r: FakeRelay = {
      callbacks,
      connectUrls: [],
      connected: false,
      connecting: false,
      discarded: false,
      connect(url: string) {
        r.connectUrls.push(url);
        r.connecting = true;
        r.connected = false;
        r.discarded = false;
      },
      disconnect() {
        // Mirrors the REAL relay-client disconnect(): closes the socket but
        // leaves onclose wired, so the close event still reaches the
        // callbacks — asynchronously, exactly like a real WebSocket close
        // event (which never fires synchronously inside close()). This is
        // what makes it possible to reproduce RCA 2026-07-06 defect 1 in a
        // unit test: a disconnect()'d socket's close can land AFTER a newer
        // relay already exists, unless something (discard() / a generation
        // guard) makes it a no-op.
        r.connected = false;
        r.connecting = false;
        setTimeout(() => {
          if (!r.discarded) r.callbacks.onClose(1000, 'closed');
        }, 0);
      },
      discard() {
        // Mirrors the REAL discard(): nulls the handlers BEFORE closing, so
        // no close event — sync or async — ever reaches the callbacks.
        r.discarded = true;
        r.connected = false;
        r.connecting = false;
      },
      send() { /* noop */ },
      sendPing() { /* noop */ },
      sendToolResponse() { /* noop */ },
      sendToolError() { /* noop */ },
      isConnected() { return r.connected; },
      isConnecting() { return r.connecting; },
    };
    relays.push(r);
    return r;
  },
}));

// Fixed browserId so the /api/state liveness probe can match "our" relay row.
vi.mock('../shared/browser-instance-id', () => ({
  getBrowserInstanceId: () => Promise.resolve('chrome:test'),
  __resetCacheForTesting: () => { /* noop */ },
}));

const WS = 'ws://127.0.0.1:7483';
const discover = (diagnostic: DiscoveryResult['diagnostic'] = 'connecting') =>
  async (): Promise<DiscoveryResult> => ({ url: WS, diagnostic });

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

function lifeUuidOf(url: string): string | null {
  const q = url.split('?')[1] ?? '';
  return new URLSearchParams(q).get('lifeUuid');
}

beforeEach(() => {
  relays.length = 0;
  // Default: bridge reachable but reports no relay for our browserId.
  globalThis.fetch = vi.fn(async () => jsonResponse({ browsers: [] })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connection-manager — relay identity stamping (§6.2/§7.1)', () => {
  it('connect() opens a relay whose URL carries role=relay, gen, and lifeUuid', async () => {
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);

    expect(relays).toHaveLength(1);
    const url = relays[0].connectUrls.at(-1)!;
    expect(url).toContain('role=relay');
    expect(url).toMatch(/[?&]gen=\d+/);
    expect(url).toMatch(/[?&]lifeUuid=[0-9a-zA-Z.-]+/);
  });
});

describe('connection-manager — 4002 supersede is terminal-but-scoped (§6.4/§7.1.3)', () => {
  it('a 4002 close sits in awaiting_sw_recovery and schedules NO reconnect', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    expect(relays).toHaveLength(1);

    // Bridge rejected this identity: a higher (gen,lifeUuid) won the collision.
    relays[0].callbacks.onClose(4002, 'superseded');

    expect(cm.getContext().diagnosticReason).toBe('awaiting_sw_recovery');
    expect(cm.isRelayAlive()).toBe(false);

    // The whole point of the fix: do NOT re-challenge with the same identity.
    // Advancing well past any backoff window must create no new relay.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(relays).toHaveLength(1);
  });

  it('a NON-4002 close (1006) is NOT treated as terminal supersede', async () => {
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    relays[0].callbacks.onClose(1006, 'abnormal');
    expect(cm.getContext().diagnosticReason).not.toBe('awaiting_sw_recovery');
  });
});

describe('connection-manager — guarded alarm re-challenge (§8.2 bridge-truth)', () => {
  async function intoAwaitingRecovery() {
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    const firstUrl = relays[0].connectUrls.at(-1)!;
    relays[0].callbacks.onClose(4002, 'superseded');
    expect(cm.getContext().diagnosticReason).toBe('awaiting_sw_recovery');
    return { cm, firstUrl };
  }

  it('DEFERS (no re-challenge) when /api/state shows a LIVE relay for our browserId', async () => {
    const { cm } = await intoAwaitingRecovery();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ browsers: [{ browserId: 'chrome:test', liveness: 'live' }] })) as unknown as typeof fetch;

    await cm.reconcile();

    // A healthy winner owns the browserId → stay quiet, no new socket.
    expect(relays).toHaveLength(1);
    expect(cm.getContext().diagnosticReason).toBe('awaiting_sw_recovery');
  });

  it("DEFERS when the bridge reports our relay as 'unknown' (fresh winner, no inbound frame yet)", async () => {
    const { cm } = await intoAwaitingRecovery();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ browsers: [{ browserId: 'chrome:test', liveness: 'unknown' }] })) as unknown as typeof fetch;

    await cm.reconcile();
    expect(relays).toHaveLength(1);
  });

  it('MINTS a fresh identity and reconnects when /api/state shows NO relay for our browserId', async () => {
    const { cm, firstUrl } = await intoAwaitingRecovery();
    globalThis.fetch = vi.fn(async () => jsonResponse({ browsers: [] })) as unknown as typeof fetch;

    await cm.reconcile();

    // No live winner → re-challenge with a strictly-fresh identity.
    expect(relays).toHaveLength(2);
    const secondUrl = relays[1].connectUrls.at(-1)!;
    expect(lifeUuidOf(secondUrl)).not.toBeNull();
    expect(lifeUuidOf(secondUrl)).not.toBe(lifeUuidOf(firstUrl));
  });

  it("re-challenges when our relay is reported 'stale' (winner wedged/gone)", async () => {
    const { cm } = await intoAwaitingRecovery();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ browsers: [{ browserId: 'chrome:test', liveness: 'stale' }] })) as unknown as typeof fetch;

    await cm.reconcile();
    expect(relays).toHaveLength(2);
  });
});

// ── Phase 1 fix: RCA 2026-07-06 same-life reconnect storm ──────────────────
// docs/rca-2026-07-06-same-life-reconnect-storm.md §4/§5. Two generator
// defects (a stale onclose from a "closed" socket dispatching into the live
// relay's slot; reconcile() treating CONNECTING as dead) combined into a
// self-sustaining ~5s reconnect loop. These tests pin the fix AND the
// inverse/adversarial cases the naive fix ("just null onclose inside
// disconnect()") would have broken.

function fakeServerInfo(overrides: Partial<{
  pid: number; port: number; version: string; buildId: string; startedBy: string;
  capabilities: string[]; uptime: number; connectedBrowsers: string[]; connectedStubs: number;
}> = {}) {
  return {
    pid: 1234,
    port: 7483,
    version: '0.5.17',
    buildId: 'test-build',
    startedBy: 'test',
    capabilities: [],
    uptime: 1,
    connectedBrowsers: [],
    connectedStubs: 0,
    ...overrides,
  };
}

describe('connection-manager — rapid double open (RCA 2026-07-06 defect 1)', () => {
  it('a stale close from a discarded/replaced socket does not null the live relay nor dispatch a spurious WS_CLOSE', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });

    // Two overlapping retry() calls before either's async openRelay() has
    // run — reproduces "rapid double openRelay()": the second call replaces
    // the first relay while its close/teardown is still in flight.
    cm.retry();
    cm.retry();
    // Drain the refreshUrl().then(openRelay) microtask chains for both calls.
    await vi.advanceTimersByTimeAsync(0);

    expect(relays).toHaveLength(2);
    expect(cm.getRelay()).toBe(relays[1]);
    expect(cm.getContext().state).toBe('connecting');

    // Let the FIRST (replaced) relay's simulated async close event fire —
    // this is the "onclose ~18ms after the new socket already exists"
    // signature from the RCA log trace.
    await vi.advanceTimersByTimeAsync(50);

    // The stale close must be a no-op: the live (second) relay reference must
    // survive, and no spurious WS_CLOSE may have knocked the state machine
    // out of 'connecting' into 'reconnecting'.
    expect(cm.getRelay()).toBe(relays[1]);
    expect(cm.getContext().state).toBe('connecting');
  });
});

describe('connection-manager — reconcile() during CONNECTING (RCA 2026-07-06 defect 2)', () => {
  it('does not tear down an in-flight CONNECTING attempt', async () => {
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    expect(relays).toHaveLength(1);
    expect(relays[0].isConnecting()).toBe(true);

    await cm.reconcile();

    // A connect attempt is already in flight — reconcile() must wait for it
    // (bounded by relay-client's own CONNECTING timeout), not stopAll()+reopen.
    expect(relays).toHaveLength(1);
    expect(cm.getRelay()).toBe(relays[0]);
  });
});

describe('connection-manager — inverse/adversarial guard: recovery paths must still fire (regression guard for the naive fix)', () => {
  // These two tests must PASS both before AND after the Phase 1 fix. A future
  // change that "fixes" defect 1 by nulling onclose inside disconnect() itself
  // (rather than adding a distinct discard() used only at the two genuine
  // replace sites) would silently break these — the whole point of pinning
  // them here.

  it('server_info timeout still leads to a disconnect + prompt reopen', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    expect(relays).toHaveLength(1);

    relays[0].callbacks.onOpen(); // starts the server_info timer; no server_info follows
    await vi.advanceTimersByTimeAsync(10_000); // SERVER_INFO_TIMEOUT_MS -> relay.disconnect()
    await vi.advanceTimersByTimeAsync(0); // let the simulated async close land
    await vi.advanceTimersByTimeAsync(6_000); // let backoff (capped at 5s) fire -> openRelay() again

    expect(relays.length).toBeGreaterThanOrEqual(2);
  });

  it('heartbeat onDead still leads to a disconnect + prompt reopen', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    relays[0].callbacks.onOpen();
    relays[0].callbacks.onServerInfo(fakeServerInfo());

    // Heartbeat: 20s interval, maxMissed 3 -> dead on the 4th tick with no pong.
    await vi.advanceTimersByTimeAsync(20_000 * 4);
    await vi.advanceTimersByTimeAsync(0); // let the simulated async close land
    await vi.advanceTimersByTimeAsync(6_000); // let backoff fire -> openRelay() again

    expect(relays.length).toBeGreaterThanOrEqual(2);
  });
});

describe('connection-manager — generation token (fix-the-class)', () => {
  it('a callback firing from a superseded relay generation is a no-op even if it still carries a wired disconnect()', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);
    expect(relays).toHaveLength(1);
    const stale = relays[0];

    // Replace with a fresh relay (normal retry path).
    cm.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(relays).toHaveLength(2);
    expect(cm.getRelay()).toBe(relays[1]);

    // The OLD relay's callbacks object is still callable (nothing stops a
    // caller from invoking it directly) — simulate a maximally-adversarial
    // stale event: the discarded relay's onClose fires directly.
    stale.callbacks.onClose(1006, 'stale-direct-fire');

    // Must be entirely inert: no effect on the live relay or state.
    expect(cm.getRelay()).toBe(relays[1]);
    expect(relays).toHaveLength(2);
  });
});

describe('connection-manager — storm convergence simulation', () => {
  it('repeated open/close churn converges to a single latched OPEN connection with heartbeat, not a fixed-cadence loop', async () => {
    vi.useFakeTimers();
    const cm = createConnectionManager({ discoverUrl: discover() });
    await cm.connect(WS);

    // Simulate a few noisy early cycles: open, then immediately closed before
    // server_info (as in the real storm's ~18ms-later 1006 close).
    for (let i = 0; i < 3; i++) {
      const current = relays[relays.length - 1];
      current.callbacks.onOpen();
      current.callbacks.onClose(1006, 'abnormal');
      // Let backoff fire and reopen.
      await vi.advanceTimersByTimeAsync(6_000);
    }

    // This time, let the connection actually succeed.
    const last = relays[relays.length - 1];
    last.callbacks.onOpen();
    last.callbacks.onServerInfo(fakeServerInfo());
    expect(cm.getContext().state).toBe('connected');

    const relayCountAfterConnect = relays.length;
    // Advance well past several would-be 5s storm cycles. A convergent fix
    // must NOT keep creating new relays — the connection is latched OPEN.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(relays).toHaveLength(relayCountAfterConnect);
    expect(cm.getContext().state).toBe('connected');
  });
});
