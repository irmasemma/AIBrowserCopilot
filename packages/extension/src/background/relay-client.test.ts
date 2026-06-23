import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRelay } from './relay-client';

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = FakeWebSocket.OPEN;
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
