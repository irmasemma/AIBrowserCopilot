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
  connect: (url: string) => void;
  disconnect: () => void;
  send: (m: unknown) => void;
  sendPing: (t: number) => void;
  sendToolResponse: (id: string, r: unknown) => void;
  sendToolError: (id: string, e: { message: string; code: string }) => void;
  isConnected: () => boolean;
}

const { relays } = vi.hoisted(() => ({ relays: [] as FakeRelay[] }));

vi.mock('./relay-client', () => ({
  createRelay: (callbacks: RelayCallbacks): FakeRelay => {
    const r: FakeRelay = {
      callbacks,
      connectUrls: [],
      connected: false,
      connect(url: string) { r.connectUrls.push(url); },
      disconnect() { r.connected = false; },
      send() { /* noop */ },
      sendPing() { /* noop */ },
      sendToolResponse() { /* noop */ },
      sendToolError() { /* noop */ },
      isConnected() { return r.connected; },
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
