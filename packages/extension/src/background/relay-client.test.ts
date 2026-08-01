import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRelay } from './relay-client';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' } as CloseEvent);
  }
  fire(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

// A WebSocket that starts CONNECTING and never fires onopen/onclose on its
// own — the browser never resolves the underlying TCP connect() (SYN
// black-holed). close() still flips readyState to CLOSED synchronously (real
// browsers do this even mid-handshake) but deliberately does NOT invoke
// onclose, modeling the gap the RCA calls out: nothing bounds a socket stuck
// in CONNECTING unless the code itself has a timer for it.
class NeverSettlesWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number = NeverSettlesWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.readyState = NeverSettlesWebSocket.CLOSED;
    // Intentionally does not fire onclose.
  }
}

let lastSocket: FakeWebSocket | null = null;

beforeEach(() => {
  lastSocket = null;
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1;
    constructor() {
      const fake = new FakeWebSocket();
      lastSocket = fake;
      // Caller assigns onopen/onclose/onerror/onmessage and calls open via lastSocket
      return fake as unknown as WebSocket;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const noopCallbacks = () => ({
  onOpen: vi.fn(),
  onClose: vi.fn(),
  onError: vi.fn(),
  onServerInfo: vi.fn(),
  onPong: vi.fn(),
  onToolRequest: vi.fn(),
  onToolScan: vi.fn(),
});

describe('relay-client server_ping handling', () => {
  it('responds to server_ping with server_pong echoing the timestamp', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');
    expect(lastSocket).not.toBeNull();

    lastSocket!.fire({ type: 'server_ping', timestamp: 999 });

    const sent = lastSocket!.sent.map((s) => JSON.parse(s));
    expect(sent).toContainEqual({ type: 'server_pong', timestamp: 999 });
  });

  it('does not invoke any callback for server_ping (it is a keepalive, not a domain event)', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    lastSocket!.fire({ type: 'server_ping', timestamp: 42 });

    expect(callbacks.onPong).not.toHaveBeenCalled();
    expect(callbacks.onServerInfo).not.toHaveBeenCalled();
    expect(callbacks.onToolRequest).not.toHaveBeenCalled();
    expect(callbacks.onToolScan).not.toHaveBeenCalled();
  });

  it('still routes pong (extension-initiated heartbeat) through onPong', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    lastSocket!.fire({ type: 'pong', timestamp: 7 });

    expect(callbacks.onPong).toHaveBeenCalledWith(7);
  });

  it('does not send server_pong if socket is no longer open', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');
    lastSocket!.readyState = FakeWebSocket.CLOSED;

    lastSocket!.fire({ type: 'server_ping', timestamp: 1 });

    expect(lastSocket!.sent).toHaveLength(0);
  });

  it('still routes tool_request after server_ping (no consumer interference)', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    lastSocket!.fire({ type: 'server_ping', timestamp: 1 });
    lastSocket!.fire({ type: 'tool_request', id: 'abc', tool: 'list_tabs', params: { x: 1 } });

    expect(callbacks.onToolRequest).toHaveBeenCalledWith('abc', 'list_tabs', { x: 1 });
  });
});

// ── Phase 1 fix: RCA 2026-07-06 same-life reconnect storm ──────────────────
// docs/rca-2026-07-06-same-life-reconnect-storm.md §4 items 1 & 3.

describe('relay-client discard() (RCA 2026-07-06 defect 1 — distinct from disconnect())', () => {
  it('nulls the socket handlers before closing, so no onclose callback fires', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');
    const socket = lastSocket!;

    relay.discard();

    // The real WebSocket.close() dispatches its close event asynchronously in
    // a browser; our FakeWebSocket.close() fires it synchronously, which is
    // the WORST case for this assertion (if discard() didn't null onclose
    // first, this synchronous fire would definitely reach the callback).
    expect(socket.onclose).toBeNull();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('still transitions the socket to CLOSED (the connection is genuinely torn down)', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');
    const socket = lastSocket!;

    relay.discard();

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(relay.isConnected()).toBe(false);
  });

  it('is idempotent and safe to call with no active socket', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    expect(() => relay.discard()).not.toThrow();
  });

  it('disconnect() (unlike discard()) leaves onclose wired — the callback still fires', () => {
    // Pinning EXISTING, unchanged semantics: disconnect() is relied on by the
    // server_info-timeout and heartbeat onDead callers in connection-manager,
    // which need the real close event to drive scheduleBackoff(). This must
    // keep working — it is the inverse-case guard against a naive fix that
    // "solves" defect 1 by nulling onclose inside disconnect() itself.
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    relay.disconnect();

    expect(callbacks.onClose).toHaveBeenCalledWith(1000, '');
  });
});

describe('relay-client CONNECTING-phase timeout (RCA 2026-07-06 §4 item 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('force-fails a socket stuck in CONNECTING (SYN black-holed) within the bound, synthesizing a close', () => {
    vi.stubGlobal('WebSocket', class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      constructor() {
        return new NeverSettlesWebSocket() as unknown as WebSocket;
      }
    });

    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    expect(callbacks.onClose).not.toHaveBeenCalled();

    // Advance past the CONNECTING-phase bound (10-15s per spec).
    vi.advanceTimersByTime(15_000);

    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    // isConnected() must report false once force-failed — nothing left to
    // route traffic through.
    expect(relay.isConnected()).toBe(false);
  });

  it('does NOT force-fail a socket that opened before the CONNECTING bound', () => {
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    lastSocket!.onopen?.({} as Event);
    vi.advanceTimersByTime(15_000);

    expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not double-dispatch onClose if the CONNECTING timeout and a real close race', () => {
    vi.stubGlobal('WebSocket', class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      constructor() {
        return new NeverSettlesWebSocket() as unknown as WebSocket;
      }
    });
    const callbacks = noopCallbacks();
    const relay = createRelay(callbacks);
    relay.connect('ws://test');

    vi.advanceTimersByTime(15_000); // force-fail fires once
    vi.advanceTimersByTime(15_000); // nothing left to fire again

    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});
