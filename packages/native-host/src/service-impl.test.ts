import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { startIpcServer, detectStartedBy } from './service-impl.js';

function uniqueIpcPath(): string {
  const id = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  if (platform() === 'win32') return `\\\\.\\pipe\\copilot-test-${id}`;
  return join(tmpdir(), `copilot-test-${id}.sock`);
}

function readUntilJson(socket: net.Socket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      socket.removeAllListeners('data');
      reject(new Error(`timeout after ${timeoutMs}ms — got: ${buffer.slice(0, 500)}`));
    }, timeoutMs);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            const msg = JSON.parse(line);
            if (predicate(msg)) {
              clearTimeout(timer);
              socket.removeAllListeners('data');
              resolve(msg);
              return;
            }
          } catch {
            // Skip non-JSON
          }
        }
        nl = buffer.indexOf('\n');
      }
    });
  });
}

function sendJsonRpc(socket: net.Socket, message: object): void {
  socket.write(JSON.stringify(message) + '\n');
}

const initializeRequest = (id: number, clientName: string) => ({
  jsonrpc: '2.0' as const,
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: clientName, version: '1.0.0' },
  },
});

describe('service-impl', () => {
  let ipcServer: net.Server | null = null;
  let ipcPath = '';
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets.length = 0;
    if (ipcServer) {
      await new Promise<void>((r) => ipcServer!.close(() => r()));
      ipcServer = null;
    }
    if (platform() !== 'win32' && ipcPath && existsSync(ipcPath)) {
      try { unlinkSync(ipcPath); } catch { /* best effort */ }
    }
  });

  describe('startIpcServer', () => {
    it('listens on the given path and accepts connections', async () => {
      ipcPath = uniqueIpcPath();
      ipcServer = await startIpcServer(ipcPath);
      const sock = net.createConnection(ipcPath);
      sockets.push(sock);
      await new Promise<void>((resolve, reject) => {
        sock.once('connect', () => resolve());
        sock.once('error', reject);
      });
      expect(sock.writable).toBe(true);
    });
  });

  describe('two stubs, independent MCP transports', () => {
    it('each connection gets its own initialize response', async () => {
      ipcPath = uniqueIpcPath();
      ipcServer = await startIpcServer(ipcPath);

      const sock1 = net.createConnection(ipcPath);
      const sock2 = net.createConnection(ipcPath);
      sockets.push(sock1, sock2);
      await Promise.all([
        new Promise<void>((r, rj) => { sock1.once('connect', () => r()); sock1.once('error', rj); }),
        new Promise<void>((r, rj) => { sock2.once('connect', () => r()); sock2.once('error', rj); }),
      ]);

      // Both stubs send initialize concurrently with different IDs
      sendJsonRpc(sock1, initializeRequest(101, 'stub-A'));
      sendJsonRpc(sock2, initializeRequest(202, 'stub-B'));

      const [resp1, resp2] = await Promise.all([
        readUntilJson(sock1, (m) => m.id === 101),
        readUntilJson(sock2, (m) => m.id === 202),
      ]);

      expect(resp1.id).toBe(101);
      expect(resp1.result?.serverInfo?.name).toBe('ai-browser-copilot');
      expect(resp2.id).toBe(202);
      expect(resp2.result?.serverInfo?.name).toBe('ai-browser-copilot');
    }, 10000);

    it('killing one stub does not affect the other', async () => {
      ipcPath = uniqueIpcPath();
      ipcServer = await startIpcServer(ipcPath);

      const sock1 = net.createConnection(ipcPath);
      const sock2 = net.createConnection(ipcPath);
      sockets.push(sock1, sock2);
      await Promise.all([
        new Promise<void>((r) => sock1.once('connect', () => r())),
        new Promise<void>((r) => sock2.once('connect', () => r())),
      ]);

      // Initialize both
      sendJsonRpc(sock1, initializeRequest(1, 'stub-A'));
      sendJsonRpc(sock2, initializeRequest(2, 'stub-B'));
      await Promise.all([
        readUntilJson(sock1, (m) => m.id === 1),
        readUntilJson(sock2, (m) => m.id === 2),
      ]);

      // Abruptly kill stub A
      sock1.destroy();

      // Stub B should still respond to a tools/list request
      sendJsonRpc(sock2, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
      const listResp = await readUntilJson(sock2, (m) => m.id === 3);
      expect(listResp.result?.tools).toBeInstanceOf(Array);
    }, 10000);
  });

  describe('detectStartedBy', () => {
    it('reads --started-by= flag', () => {
      expect(detectStartedBy(['node', 'service', '--started-by=Claude Code'], {})).toBe('Claude Code');
    });

    it('reads COPILOT_STARTED_BY env', () => {
      expect(detectStartedBy([], { COPILOT_STARTED_BY: 'VS Code' })).toBe('VS Code');
    });

    it('defaults to "service"', () => {
      expect(detectStartedBy([], {})).toBe('service');
    });
  });
});
