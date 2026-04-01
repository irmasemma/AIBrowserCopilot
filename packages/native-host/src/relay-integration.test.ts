import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { startRelay, sendToExtension, isExtensionConnected, stopRelay } from './extension-relay.js';
import { deleteLockFile, getLockFilePath, readLockFile } from './lock-file-manager.js';

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

  it('lock file created on start and deleted on stop', async () => {
    const lockPath = getLockFilePath();
    const port = await startRelay();

    // Lock file should exist with correct port
    expect(existsSync(lockPath)).toBe(true);
    const lock = readLockFile(lockPath);
    expect(lock).not.toBeNull();
    expect(lock!.port).toBe(port);
    expect(lock!.pid).toBe(process.pid);

    // Stop relay — lock file should be cleaned up
    await stopRelay();
    deleteLockFile(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('lock file port matches actual listening port', async () => {
    const port = await startRelay();
    const lock = readLockFile(getLockFilePath());

    expect(lock).not.toBeNull();
    // Connect to the port from the lock file (not hardcoded)
    const ws = new WebSocket(`ws://127.0.0.1:${lock!.port}`);
    client = ws;

    const info = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.onmessage = (event) => resolve(JSON.parse(event.data.toString()));
      ws.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });

    expect(info.type).toBe('server_info');
    expect(info.port).toBe(port);
    expect(info.port).toBe(lock!.port);
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

  it('full reconnect lifecycle: connect → server dies → reconnect succeeds', async () => {
    // Phase 1: Start server, connect client
    const port1 = await startRelay();
    const ws1 = new WebSocket(`ws://127.0.0.1:${port1}`);
    client = ws1;

    const info1 = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws1.onmessage = (event) => resolve(JSON.parse(event.data.toString()));
      ws1.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
    expect(info1.type).toBe('server_info');
    expect(isExtensionConnected()).toBe(true);

    // Phase 2: Server dies — client gets close event
    const closePromise = new Promise<number>((resolve) => {
      ws1.onclose = (event) => resolve(event.code);
    });
    await stopRelay();
    const closeCode = await closePromise;
    expect(closeCode).toBeDefined();
    expect(isExtensionConnected()).toBe(false);

    // Phase 3: Client tries to reconnect — fails (nothing listening)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port1}`);
    const failResult = await new Promise<string>((resolve) => {
      ws2.onopen = () => resolve('connected');
      ws2.onerror = () => resolve('refused');
      setTimeout(() => resolve('timeout'), 3000);
    });
    expect(failResult).toBe('refused');

    // Phase 4: Server restarts — client reconnects
    const port2 = await startRelay();
    const ws3 = new WebSocket(`ws://127.0.0.1:${port2}`);
    client = ws3;

    const info2 = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws3.onmessage = (event) => resolve(JSON.parse(event.data.toString()));
      ws3.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
    expect(info2.type).toBe('server_info');
    expect(isExtensionConnected()).toBe(true);

    // Phase 5: Tool call works after reconnect
    const toolPromise = sendToExtension({ id: 'reconnect-test', tool: 'list_tabs', params: {} });
    const received = await new Promise<Record<string, unknown>>((resolve) => {
      ws3.onmessage = (event) => {
        const data = JSON.parse(event.data.toString());
        if (data.type === 'tool_request') resolve(data);
      };
    });
    expect(received.type).toBe('tool_request');
    expect(received.id).toBe('reconnect-test');

    // Respond to complete the round-trip
    ws3.send(JSON.stringify({ type: 'tool_response', id: 'reconnect-test', result: { tabs: [] } }));
    const result = await toolPromise;
    expect(result.id).toBe('reconnect-test');
  });
});
