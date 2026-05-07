import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';

describe('browserId parsing', () => {
  function parseQuery(url: string | undefined): URLSearchParams {
    if (!url) return new URLSearchParams();
    const qi = url.indexOf('?');
    return qi === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(qi + 1));
  }

  it('extracts browserId', () => {
    expect(parseQuery('/?browserId=chrome').get('browserId')).toBe('chrome');
    expect(parseQuery('/?browserId=edge&token=abc').get('browserId')).toBe('edge');
  });

  it('returns null when missing', () => {
    expect(parseQuery(undefined).get('browserId')).toBeNull();
    expect(parseQuery('/').get('browserId')).toBeNull();
  });

  it('extracts role=mcp', () => {
    expect(parseQuery('/?role=mcp').get('role')).toBe('mcp');
  });
});

describe('multi-browser WS', () => {
  it('accepts Chrome + Edge simultaneously', async () => {
    const port = 18900 + Math.floor(Math.random() * 100);
    const connected: string[] = [];

    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    wss.on('connection', (_ws, req) => {
      const qi = (req.url ?? '').indexOf('?');
      if (qi !== -1) {
        const p = new URLSearchParams(req.url!.slice(qi + 1));
        connected.push(p.get('browserId') || 'default');
      }
    });

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}?browserId=chrome`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?browserId=edge`);
    await new Promise<void>((r) => { let c = 0; const ck = () => { if (++c === 2) r(); }; ws1.on('open', ck); ws2.on('open', ck); });
    await new Promise((r) => setTimeout(r, 50));

    expect(connected).toContain('chrome');
    expect(connected).toContain('edge');

    ws1.close(); ws2.close(); wss.close();
  });

  it('distinguishes extension from MCP client by role param', async () => {
    const port = 19100 + Math.floor(Math.random() * 100);
    const roles: string[] = [];

    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    wss.on('connection', (_ws, req) => {
      const qi = (req.url ?? '').indexOf('?');
      const p = qi !== -1 ? new URLSearchParams(req.url!.slice(qi + 1)) : new URLSearchParams();
      roles.push(p.get('role') || 'extension');
    });

    const ext = new WebSocket(`ws://127.0.0.1:${port}?browserId=chrome`);
    const mcp = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
    await new Promise<void>((r) => { let c = 0; const ck = () => { if (++c === 2) r(); }; ext.on('open', ck); mcp.on('open', ck); });
    await new Promise((r) => setTimeout(r, 50));

    expect(roles).toContain('extension');
    expect(roles).toContain('mcp');

    ext.close(); mcp.close(); wss.close();
  });
});

describe('port detection logic', () => {
  it('second server on same port fails with EADDRINUSE', async () => {
    const port = 19200 + Math.floor(Math.random() * 100);
    const wss = new WebSocketServer({ host: '127.0.0.1', port });

    const error = await new Promise<string>((resolve) => {
      const wss2 = new WebSocketServer({ host: '127.0.0.1', port });
      wss2.on('error', (err) => resolve(err.message));
    });

    expect(error).toContain('EADDRINUSE');
    wss.close();
  });

  it('WS client can connect to existing server', async () => {
    const port = 19300 + Math.floor(Math.random() * 100);
    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    let received = '';
    wss.on('connection', (ws) => {
      ws.on('message', (data) => { received = data.toString(); });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
    await new Promise<void>((r) => ws.on('open', r));
    ws.send('hello');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toBe('hello');
    ws.close(); wss.close();
  });
});
