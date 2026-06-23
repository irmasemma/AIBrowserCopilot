import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import {
  parseBrand,
  extractBrowserIdFromTabId,
  mergeFanOutListTabs,
  isAllowedOrigin,
  extensionIdFromOrigin,
  loadAllowedExtensionIds,
  translateExtensionResponse,
  handleExtension,
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

describe('collision guard (single-relay invariant)', () => {
  // Boots a bare WS server that routes every connection through the real
  // handleExtension() — the production collision logic, minus origin auth.
  function makeServer(): { wss: WebSocketServer; port: number } {
    const port = 19500 + Math.floor(Math.random() * 400);
    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    wss.on('connection', (ws, req) => {
      const qi = (req.url ?? '').indexOf('?');
      const p = qi !== -1 ? new URLSearchParams(req.url!.slice(qi + 1)) : new URLSearchParams();
      handleExtension(
        ws as unknown as Parameters<typeof handleExtension>[0],
        p.get('browserId') || 'default',
        p.get('role') === 'relay', // canonical relay marker, mirrors production routing
      );
    });
    return { wss, port };
  }

  function waitFor<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }
  function onceServerInfo(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      ws.on('message', (d) => { try { if (JSON.parse(String(d)).type === 'server_info') resolve(); } catch { /* */ } });
    });
  }

  it('rejects a NON-canonical duplicate (no role=relay) against a LIVE incumbent with 4002', async () => {
    // A stale-client probe / legacy build using the real browserId but WITHOUT
    // role=relay must NOT kill the live relay — the original v0.5.11 protection.
    const { wss, port } = makeServer();
    const id = 'chrome:live-incumbent';

    // Incumbent answers server_ping with server_pong → proves itself alive.
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
    ws1.on('message', (d) => {
      try { if (JSON.parse(String(d)).type === 'server_ping') ws1.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() })); } catch { /* */ }
    });
    let ws1Closed = false;
    ws1.on('close', () => { ws1Closed = true; });
    await waitFor(onceServerInfo(ws1), 3000);

    // Non-canonical duplicate (no role=relay) for the same browserId.
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
    const ws2Close = await waitFor(new Promise<number>((resolve) => ws2.on('close', (code) => resolve(code))), 4000);

    expect(ws2Close).toBe(4002);     // duplicate rejected
    expect(ws1Closed).toBe(false);   // live relay preserved
    expect(ws1.readyState).toBe(WebSocket.OPEN);

    ws1.close(); wss.close();
  }, 10_000);

  it('INVERSE CASE: a canonical relay (role=relay) SUPERSEDES a still-live incumbent — accepted, not 4002-looped', async () => {
    // This is the case the v0.5.11 liveness heuristic got WRONG: a real client
    // reconnecting (new SW life, role=relay) while a stale socket still pongs.
    // Identity wins: the newest canonical relay is accepted; the old is closed.
    const { wss, port } = makeServer();
    const id = 'chrome:reconnecting-relay';

    // Incumbent: a canonical relay that STILL answers server_ping (lingering).
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}&role=relay`);
    ws1.on('message', (d) => {
      try { if (JSON.parse(String(d)).type === 'server_ping') ws1.send(JSON.stringify({ type: 'server_pong', timestamp: Date.now() })); } catch { /* */ }
    });
    let ws1Closed = false;
    ws1.on('close', () => { ws1Closed = true; });
    await waitFor(onceServerInfo(ws1), 3000);

    // The real client reconnects as a canonical relay for the same browserId.
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}&role=relay`);
    let ws2Closed4002 = false;
    ws2.on('close', (code) => { if (code === 4002) ws2Closed4002 = true; });

    await waitFor(onceServerInfo(ws2), 4000);   // ACCEPTED — got server_info, not 4002

    expect(ws2.readyState).toBe(WebSocket.OPEN);
    expect(ws2Closed4002).toBe(false);          // no 4002 loop
    await waitFor(new Promise<void>((resolve) => { if (ws1Closed) resolve(); else ws1.on('close', () => resolve()); }), 2000);
    expect(ws1Closed).toBe(true);               // superseded incumbent closed

    ws2.close(); wss.close();
  }, 10_000);

  it('DOES replace a DEAD incumbent (orphan) — accepts the reconnect', async () => {
    const { wss, port } = makeServer();
    const id = 'chrome:dead-incumbent';

    // Incumbent ignores server_ping → wedged orphan.
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
    let ws1Closed = false;
    ws1.on('close', () => { ws1Closed = true; });
    await waitFor(onceServerInfo(ws1), 3000);

    // Reconnect for the same browserId — should be accepted after the
    // incumbent fails its liveness probe (~1.5s), and the orphan terminated.
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}?browserId=${id}`);
    await waitFor(onceServerInfo(ws2), 4000);   // accepted (got server_info)

    expect(ws2.readyState).toBe(WebSocket.OPEN);
    await waitFor(new Promise<void>((resolve) => { if (ws1Closed) resolve(); else ws1.on('close', () => resolve()); }), 2000);
    expect(ws1Closed).toBe(true);   // orphan replaced

    ws2.close(); wss.close();
  }, 10_000);
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

  it('returns an empty tabs array AND isError:true when all browsers fail', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: false, error: 'timeout' },
      { browserId: 'chrome:B', ok: false, error: 'closed' },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toHaveLength(2);
    // Critical: when EVERY target failed, the MCP result must be flagged
    // as an error. Otherwise VS Code / Cursor / Claude see a "success"
    // response whose content text happens to be an error JSON, parse it,
    // and show confusing timeout messages while bridge reports success.
    expect(merged.isError).toBe(true);
  });

  it('does NOT set isError on partial success (some tabs returned)', () => {
    const results: Array<FanOutResult | FanOutError> = [
      { browserId: 'chrome:A', ok: true, response: { result: { content: [{ type: 'text', text: '[{"id":"chrome:A:1"}]' }] } } },
      { browserId: 'chrome:B', ok: false, error: 'timeout' },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toHaveLength(1);
    expect(payload.errors).toHaveLength(1);
    // Partial success: at least one browser returned tabs, so don't flag
    // as error — the MCP client can surface the `errors` field if it cares.
    expect(merged.isError).toBeUndefined();
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

describe('isAllowedOrigin (pinned to extension IDs)', () => {
  const ourId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const otherId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const allowlist = new Set([ourId]);

  it('accepts chrome-extension:// origin with a listed ID', () => {
    expect(isAllowedOrigin(`chrome-extension://${ourId}`, allowlist)).toBe(true);
  });

  it('rejects chrome-extension:// origin with an unlisted ID', () => {
    // This is the defense-in-depth case: a co-installed malicious extension
    // can no longer drive the bridge via chrome.debugger blast radius.
    expect(isAllowedOrigin(`chrome-extension://${otherId}`, allowlist)).toBe(false);
  });

  it('rejects moz-extension:// when allowlist is for chrome IDs', () => {
    // Same allowlist applies to all extension schemes — an attacker can't
    // bypass by claiming a different scheme.
    expect(isAllowedOrigin(`moz-extension://${otherId}`, allowlist)).toBe(false);
  });

  it('still accepts missing Origin (Node MCP clients) when allowlist is set', () => {
    expect(isAllowedOrigin(undefined, allowlist)).toBe(true);
    expect(isAllowedOrigin('', allowlist)).toBe(true);
  });

  it('empty allowlist falls back to accepting any extension-scheme origin', () => {
    const empty = new Set<string>();
    expect(isAllowedOrigin(`chrome-extension://${otherId}`, empty)).toBe(true);
    expect(isAllowedOrigin(`moz-extension://${otherId}`, empty)).toBe(true);
  });

  it('rejects non-extension origins regardless of allowlist', () => {
    expect(isAllowedOrigin('https://attacker.com', allowlist)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', allowlist)).toBe(false);
  });

  it('accepts when extension ID has a trailing path segment', () => {
    // Some browsers append a path: chrome-extension://<id>/popup.html → "/"
    expect(isAllowedOrigin(`chrome-extension://${ourId}/`, allowlist)).toBe(true);
  });
});

describe('extensionIdFromOrigin', () => {
  it('extracts the bare ID', () => {
    expect(extensionIdFromOrigin('chrome-extension://abcdef')).toBe('abcdef');
    expect(extensionIdFromOrigin('moz-extension://uuid-here')).toBe('uuid-here');
  });

  it('stops at the first path slash', () => {
    expect(extensionIdFromOrigin('chrome-extension://abc/popup.html')).toBe('abc');
  });

  it('returns empty string for non-extension origins', () => {
    expect(extensionIdFromOrigin('https://example.com')).toBe('');
    expect(extensionIdFromOrigin('http://localhost:5173/foo')).toBe('');
    expect(extensionIdFromOrigin('')).toBe('');
  });
});

describe('loadAllowedExtensionIds', () => {
  it('parses comma-separated env var', () => {
    const ids = loadAllowedExtensionIds({
      env: { AGENTHUB_ALLOWED_EXTENSION_IDS: 'aaa,bbb, ccc , ' },
      installDir: '/nonexistent-for-test',
    });
    expect(Array.from(ids).sort()).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('returns empty set when env unset and config file absent', () => {
    const ids = loadAllowedExtensionIds({
      env: {},
      installDir: '/nonexistent-for-test',
    });
    expect(ids.size).toBe(0);
  });

  it('reads extension-ids.json when env unset', () => {
    const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'agenthub-allowlist-'));
    try {
      writeFileSync(join(dir, 'extension-ids.json'), JSON.stringify(['file-id-1', 'file-id-2']));
      const ids = loadAllowedExtensionIds({ env: {}, installDir: dir });
      expect(Array.from(ids).sort()).toEqual(['file-id-1', 'file-id-2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('env var takes precedence over config file when both present', () => {
    const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'agenthub-allowlist-'));
    try {
      writeFileSync(join(dir, 'extension-ids.json'), JSON.stringify(['file-only']));
      const ids = loadAllowedExtensionIds({
        env: { AGENTHUB_ALLOWED_EXTENSION_IDS: 'env-wins' },
        installDir: dir,
      });
      expect(Array.from(ids)).toEqual(['env-wins']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives malformed config file (returns empty set, no throw)', () => {
    const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'agenthub-allowlist-'));
    try {
      writeFileSync(join(dir, 'extension-ids.json'), 'not-json {{');
      const ids = loadAllowedExtensionIds({ env: {}, installDir: dir });
      expect(ids.size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

// ─────────────────────────────────────────────────────────────────────────
// Regression coverage for the "tools return empty" bug reported in
// docs/session-2026-06-04-postdownloader-overhaul.md §21. Two compounding
// causes — both addressed by the changes around translateExtensionResponse,
// preValidateToolCall, and the JSON Schema `required` emission below.
// ─────────────────────────────────────────────────────────────────────────

describe('translateExtensionResponse — extension wire-envelope translation', () => {
  it('translates a tool_error envelope into an MCP tool-error result (not empty)', () => {
    // This is the exact shape the extension's relay-client.ts:127-129 sends
    // when dispatchTool throws (e.g. getTab(undefined) → "tab_id is required").
    // Before this translator, handleMcpMessage did `result: resp.result ?? resp`,
    // which leaked the raw envelope as the MCP `result`. MCP clients then
    // saw no `content` array and rendered the call as empty.
    const extensionResp = {
      type: 'tool_error',
      id: 'b_req_1',
      error: {
        message: 'tab_id is required. Call list_tabs first to get a tab id.',
        code: 'TAB_NOT_FOUND',
      },
    };
    const translated = translateExtensionResponse(extensionResp);
    expect(translated.isError).toBe(true);
    expect(translated.content).toEqual([{
      type: 'text',
      text: 'tab_id is required. Call list_tabs first to get a tab id.',
    }]);
  });

  it('passes a tool_response success envelope through with content intact', () => {
    const extensionResp = {
      type: 'tool_response',
      id: 'b_req_2',
      result: { content: [{ type: 'text', text: 'hello world' }] },
    };
    const translated = translateExtensionResponse(extensionResp);
    expect(translated.isError).toBeUndefined();
    expect(translated.content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('falls back gracefully on null/undefined input (text is always a non-empty string)', () => {
    // JSON.stringify(undefined) returns the value undefined, not the string
    // "undefined". Without the String() guard we'd end up with text:
    // undefined in the MCP block — reproducing the original "empty" bug.
    for (const input of [null, undefined]) {
      const t = translateExtensionResponse(input);
      expect(t.content.length).toBeGreaterThan(0);
      expect(typeof t.content[0].text).toBe('string');
      expect((t.content[0].text as string).length).toBeGreaterThan(0);
    }
  });
});

describe('mergeFanOutListTabs — tool_error envelope handling', () => {
  it('surfaces a raw extension tool_error envelope without crashing or losing the message', () => {
    // The fan-out version of the same bug as translateExtensionResponse —
    // list_tabs calls into extensions in parallel, and if any of them throws
    // we want the error text to flow through to the user.
    const results: Array<FanOutResult | FanOutError> = [
      {
        browserId: 'chrome:A',
        ok: true,
        response: { result: { content: [{ type: 'text', text: '[]' }] } },
      },
      {
        browserId: 'chrome:B',
        ok: true,
        response: {
          type: 'tool_error',
          id: 'b_req_99',
          error: { message: 'list_tabs failed: chrome.tabs unavailable', code: 'CONTENT_UNAVAILABLE' },
        },
      },
    ];
    const merged = mergeFanOutListTabs(results);
    const payload = JSON.parse(merged.content[0].text);
    expect(payload.tabs).toEqual([]);
    expect(payload.errors).toEqual([
      { browserId: 'chrome:B', error: 'list_tabs failed: chrome.tabs unavailable' },
    ]);
  });
});
