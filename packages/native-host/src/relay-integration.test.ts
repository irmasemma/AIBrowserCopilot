import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay, sendToExtension, isExtensionConnected, stopRelay } from './extension-relay.js';
import { deleteLockFile, getLockFilePath } from './lock-file-manager.js';

/**
 * Integration tests for the extension relay.
 * These use REAL WebSocket connections — no mocks.
 * Every bug found in the 2026-03-31 debugging session would have been caught here.
 */
describe('relay integration', () => {
  let client: WebSocket | null = null;

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) {
      client.close();
      await new Promise((r) => setTimeout(r, 50));
    }
    client = null;
    await stopRelay();
    deleteLockFile(getLockFilePath());
  });

  async function startAndConnect(): Promise<{ port: number; ws: WebSocket }> {
    const port = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    client = ws;

    // Wait for server_info (confirms connection is fully established)
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = () => resolve();
      ws.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    return { port, ws };
  }

  it('sends server_info immediately on client connect', async () => {
    const port = await startRelay();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    client = ws;

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data.toString()));
      };
      ws.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });

    expect(info.type).toBe('server_info');
    expect(info.pid).toBe(process.pid);
    expect(info.port).toBe(port);
    expect(typeof info.version).toBe('string');
    expect(Array.isArray(info.capabilities)).toBe(true);
    expect(typeof info.uptime).toBe('number');
  });

  it('tool_request includes type field', async () => {
    const { ws } = await startAndConnect();

    // Send a tool request from the server side
    const requestPromise = sendToExtension({ id: 'test-1', tool: 'list_tabs', params: {} });

    // Receive on client side — verify the type field is present
    const received = await new Promise<Record<string, unknown>>((resolve) => {
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data.toString());
        if (data.type === 'tool_request') {
          resolve(data);
        }
      };
    });

    expect(received.type).toBe('tool_request');
    expect(received.id).toBe('test-1');
    expect(received.tool).toBe('list_tabs');
    expect(received.params).toEqual({});

    // Respond to avoid timeout
    ws.send(JSON.stringify({ type: 'tool_response', id: 'test-1', result: { content: [] } }));
    await requestPromise;
  });

  it('tool_response resolves pending request', async () => {
    const { ws } = await startAndConnect();

    const resultPromise = sendToExtension({ id: 'test-2', tool: 'take_screenshot', params: { format: 'png' } });

    // Client receives request and responds
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.type === 'tool_request' && data.id === 'test-2') {
        ws.send(JSON.stringify({ type: 'tool_response', id: 'test-2', result: { image: 'base64data' } }));
      }
    };

    const result = await resultPromise;
    expect(result.id).toBe('test-2');
    expect(result.result).toEqual({ image: 'base64data' });
    expect(result.error).toBeUndefined();
  });

  it('tool_error resolves with error', async () => {
    const { ws } = await startAndConnect();

    const resultPromise = sendToExtension({ id: 'test-3', tool: 'navigate', params: {} });

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      if (data.type === 'tool_request' && data.id === 'test-3') {
        ws.send(JSON.stringify({ type: 'tool_response', id: 'test-3', error: { message: 'Tab not found', code: 'TAB_NOT_FOUND' } }));
      }
    };

    const result = await resultPromise;
    expect(result.id).toBe('test-3');
    expect(result.error).toEqual({ message: 'Tab not found', code: 'TAB_NOT_FOUND' });
  });

  it('rejects when no client connected', async () => {
    await startRelay();
    // Don't connect a client
    expect(isExtensionConnected()).toBe(false);
    await expect(sendToExtension({ id: 'test-4', tool: 'list_tabs', params: {} }))
      .rejects.toThrow('Extension not connected');
  });

  it('client disconnect rejects pending requests', async () => {
    const { ws } = await startAndConnect();

    const resultPromise = sendToExtension({ id: 'test-5', tool: 'list_tabs', params: {} });

    // Wait for request to be sent, then disconnect
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    client = null;

    await expect(resultPromise).rejects.toThrow('Extension disconnected');
  });

  it('ping/pong round-trip', async () => {
    const { ws } = await startAndConnect();

    const timestamp = Date.now();
    ws.send(JSON.stringify({ type: 'ping', timestamp }));

    const pong = await new Promise<Record<string, unknown>>((resolve) => {
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data.toString());
        if (data.type === 'pong') {
          resolve(data);
        }
      };
    });

    expect(pong.type).toBe('pong');
    expect(pong.timestamp).toBe(timestamp);
  });

  it('accepts connection without token (localhost-only)', async () => {
    const port = await startRelay();
    // Connect without any token query param
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    client = ws;

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.onmessage = (event) => resolve(JSON.parse(event.data.toString()));
      ws.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });

    // Should connect and receive server_info (no 4001 close)
    expect(info.type).toBe('server_info');
    expect(isExtensionConnected()).toBe(true);
  });
});
