import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import {
  parseBrand,
  extractBrowserIdFromTabId,
  mergeFanOutListTabs,
  isAllowedOrigin,
  type FanOutResult,
  type FanOutError,
} from './service.js';

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

describe('parseBrand', () => {
  it('returns brand portion of composite browserId', () => {
    expect(parseBrand('chrome:abc-123')).toBe('chrome');
    expect(parseBrand('edge:profile-A')).toBe('edge');
  });

  it('returns the input as-is for legacy brand-only ids', () => {
    expect(parseBrand('chrome')).toBe('chrome');
    expect(parseBrand('edge')).toBe('edge');
  });

  it('handles ids with multiple colons (splits on the first one)', () => {
    expect(parseBrand('chrome:a:b')).toBe('chrome');
  });
});

describe('extractBrowserIdFromTabId', () => {
  it('extracts composite browserId from a namespaced tab id', () => {
    expect(extractBrowserIdFromTabId('chrome:abc-123:622786441')).toBe('chrome:abc-123');
  });

  it('extracts brand-only browserId from a legacy namespaced tab id', () => {
    expect(extractBrowserIdFromTabId('chrome:42')).toBe('chrome');
  });

  it('returns empty for raw integer tab ids (caller falls back)', () => {
    expect(extractBrowserIdFromTabId('622786441')).toBe('');
    expect(extractBrowserIdFromTabId(622786441)).toBe('');
  });

  it('returns empty for missing or non-string non-number input', () => {
    expect(extractBrowserIdFromTabId(undefined)).toBe('');
    expect(extractBrowserIdFromTabId(null)).toBe('');
    expect(extractBrowserIdFromTabId({})).toBe('');
  });

  it('returns empty for malformed strings', () => {
    expect(extractBrowserIdFromTabId('chrome:abc:notnum')).toBe('');
    expect(extractBrowserIdFromTabId('chrome:abc:')).toBe('');
    expect(extractBrowserIdFromTabId(':42')).toBe('');
  });

  it('preserves multi-colon browserIds (splits on the LAST colon)', () => {
    expect(extractBrowserIdFromTabId('chrome:a:b:42')).toBe('chrome:a:b');
  });
});

describe('mergeFanOutListTabs', () => {
  const mockResp = (tabs: unknown[]) =>
    ({ result: { content: [{ type: 'text', text: JSON.stringify(tabs) }] } });

  it('concatenates tabs across multiple successful browsers', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: mockResp([{ id: 'chrome:A:1', title: 'a1' }]) },
      { browserId: 'chrome:B', ok: true, response: mockResp([{ id: 'chrome:B:2', title: 'b2' }]) },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toHaveLength(2);
    expect(payload.tabs[0].id).toBe('chrome:A:1');
    expect(payload.tabs[1].id).toBe('chrome:B:2');
    expect(payload.errors).toBeUndefined();
  });

  it('reports errors per-browser without dropping the successes', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: mockResp([{ id: 'chrome:A:1' }]) },
      { browserId: 'chrome:B', ok: false, error: 'timeout' },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toHaveLength(1);
    expect(payload.errors).toEqual([{ browserId: 'chrome:B', error: 'timeout' }]);
  });

  it('reports parse_failed when a browser returns malformed text', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { result: { content: [{ type: 'text', text: 'not-json' }] } } },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].error).toMatch(/^parse_failed:/);
  });

  it('returns an empty tabs array when all browsers fail', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: false, error: 'timeout' },
      { browserId: 'chrome:B', ok: false, error: 'closed' },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toHaveLength(2);
  });

  it('surfaces extension tool-error envelope as the actual error message (not parse_failed)', () => {
    const errResp = {
      result: {
        isError: true,
        content: [{ type: 'text', text: 'Tool execution failed: chrome.tabs.query unavailable' }],
      },
    };
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { result: { content: [{ type: 'text', text: '[]' }] } } },
      { browserId: 'chrome:B', ok: true, response: errResp },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toEqual([
      { browserId: 'chrome:B', error: 'Tool execution failed: chrome.tabs.query unavailable' },
    ]);
  });

  it('surfaces JSON-RPC error envelope', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { error: { message: 'method not found' } } },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toEqual([{ browserId: 'chrome:A', error: 'method not found' }]);
  });

  it('reports malformed_envelope when text is missing/non-string', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { result: { content: [] } } },
      { browserId: 'chrome:B', ok: true, response: {} },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toEqual([
      { browserId: 'chrome:A', error: 'malformed_envelope' },
      { browserId: 'chrome:B', error: 'malformed_envelope' },
    ]);
  });

  it('reports expected_array when text parses to a non-array (no silent drop)', () => {
    // Catches contract violations early — previously this case silently
    // contributed zero tabs with no error reported.
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { result: { content: [{ type: 'text', text: '{"tabs":[]}' }] } } },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toEqual([{ browserId: 'chrome:A', error: 'expected_array' }]);
  });
});

describe('isAllowedOrigin', () => {
  it('accepts missing Origin (Node MCP clients send no Origin header)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('accepts chrome-extension:// origins', () => {
    expect(isAllowedOrigin('chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef')).toBe(true);
  });

  it('accepts moz-extension:// and safari-web-extension:// origins', () => {
    expect(isAllowedOrigin('moz-extension://abc')).toBe(true);
    expect(isAllowedOrigin('safari-web-extension://abc')).toBe(true);
  });

  it('rejects http://localhost (the dev-server attack vector)', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:8080')).toBe(false);
  });

  it('rejects https origins (web pages on attacker-controlled domains)', () => {
    expect(isAllowedOrigin('https://attacker.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  it('rejects file:// origins', () => {
    expect(isAllowedOrigin('file://')).toBe(false);
  });

  it('rejects spoofing attempts (substring matches must be at start)', () => {
    expect(isAllowedOrigin('https://chrome-extension.attacker.com')).toBe(false);
    expect(isAllowedOrigin('http://moz-extension.attacker.com')).toBe(false);
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
