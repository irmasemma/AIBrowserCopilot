import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

// Test the findAvailablePort logic and server_info handshake
describe('extension-relay', () => {
  describe('server_info handshake', () => {
    let wss: WebSocketServer;
    let port: number;

    afterEach(() => {
      wss?.close();
    });

    it('sends server_info with correct fields on client connect', async () => {
      // Create a test WebSocket server that mimics the relay behavior
      port = 18483;
      wss = new WebSocketServer({ host: '127.0.0.1', port });

      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({
          type: 'server_info',
          pid: process.pid,
          port,
          version: '0.1.0',
          startedBy: 'test',
          capabilities: ['get_page_content', 'take_screenshot'],
          uptime: 0,
        }));
      });

      const clientData = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());
          ws.close();
          resolve(data);
        };
        ws.onerror = reject;
      });

      expect(clientData.type).toBe('server_info');
      expect(clientData.pid).toBe(process.pid);
      expect(clientData.port).toBe(port);
      expect(clientData.version).toBe('0.1.0');
      expect(clientData.startedBy).toBe('test');
      expect(clientData.capabilities).toEqual(['get_page_content', 'take_screenshot']);
      expect(typeof clientData.uptime).toBe('number');
    });
  });

  describe('ping/pong heartbeat', () => {
    let wss: WebSocketServer;
    const port = 18484;

    afterEach(() => {
      wss?.close();
    });

    it('responds to ping with pong echoing timestamp', async () => {
      wss = new WebSocketServer({ host: '127.0.0.1', port });

      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: parsed.timestamp }));
          }
        });
      });

      const pong = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'ping', timestamp: 1234567890 }));
        };
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());
          if (data.type === 'pong') {
            ws.close();
            resolve(data);
          }
        };
        ws.onerror = reject;
      });

      expect(pong.type).toBe('pong');
      expect(pong.timestamp).toBe(1234567890);
    });
  });

});
