import { describe, it, expect, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { handleDiagRequest, RecentActivity, type DiagServerHooks } from './diag-server.js';

/**
 * Build a minimal fake IncomingMessage + ServerResponse pair for testing
 * the diag handler without spinning up a real http.Server.
 *
 * Returns { req, res, captured } — captured.body and captured.headers
 * populate when the handler calls res.writeHead + res.end.
 */
function fakeReq(opts: {
  method?: string;
  url?: string;
  origin?: string;
  remote?: string;
}): {
  req: IncomingMessage;
  res: ServerResponse;
  captured: { statusCode: number; headers: Record<string, string>; body: string };
} {
  const captured = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  const socket = new Socket();
  // Stub the property since the actual Socket has a getter-only remoteAddress.
  Object.defineProperty(socket, 'remoteAddress', { value: opts.remote ?? '127.0.0.1', configurable: true });
  const req = new IncomingMessage(socket);
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/';
  req.headers = {
    host: '127.0.0.1:7483',
    ...(opts.origin ? { origin: opts.origin } : {}),
  };
  const res = new ServerResponse(req);
  res.writeHead = ((status: number, headers?: Record<string, string>) => {
    captured.statusCode = status;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        captured.headers[k.toLowerCase()] = String(v);
      }
    }
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((body?: string) => {
    if (body) captured.body = body;
    return res;
  }) as ServerResponse['end'];
  return { req, res, captured };
}

function makeHooks(overrides: Partial<DiagServerHooks> = {}): DiagServerHooks {
  const recentActivity = new RecentActivity();
  return {
    onRestartRequest: vi.fn(),
    onReloadExtensionRequest: vi.fn((browserId?: string) => ({ broadcastTo: browserId ? 1 : 0, ...(browserId ? { matchedBrowserId: browserId } : {}) })),
    getState: () => ({
      bridge: {
        version: '0.5.10', buildId: 'dev', pid: 12345, port: 7483, uptimeSec: 60,
        startedBy: 'service', allowedExtensionIdsCount: 1, allowedExtensionIdsSample: ['abc12345…'],
      },
      browsers: [],
      mcpClients: [],
      recentActivity,
    }),
    logPaths: () => ({ bridge: '/tmp/bridge.log', extension: '/tmp/ext.log', helper: '/tmp/helper.log' }),
    ...overrides,
  };
}

describe('handleDiagRequest — localhost guard', () => {
  it('rejects non-loopback callers with 403', () => {
    const { req, res, captured } = fakeReq({ remote: '192.168.1.50', url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(403);
    expect(JSON.parse(captured.body).ok).toBe(false);
  });

  it('accepts 127.0.0.1', () => {
    const { req, res, captured } = fakeReq({ remote: '127.0.0.1', url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
  });

  it('accepts ::1', () => {
    const { req, res, captured } = fakeReq({ remote: '::1', url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
  });
});

describe('handleDiagRequest — CORS for read endpoints', () => {
  it('echoes Access-Control-Allow-Origin for chrome-extension:// origin on GET /api/state', () => {
    const { req, res, captured } = fakeReq({
      url: '/api/state',
      origin: 'chrome-extension://godmaogbmafekfmonphpolmgkdhopcll',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['access-control-allow-origin']).toBe('chrome-extension://godmaogbmafekfmonphpolmgkdhopcll');
    expect(captured.headers['vary']).toBe('origin');
  });

  it('echoes Access-Control-Allow-Origin for moz-extension:// origin', () => {
    const { req, res, captured } = fakeReq({
      url: '/api/state',
      origin: 'moz-extension://abc',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.headers['access-control-allow-origin']).toBe('moz-extension://abc');
  });

  it('does NOT include CORS header for web page origin (browser blocks fetch)', () => {
    const { req, res, captured } = fakeReq({
      url: '/api/state',
      origin: 'https://evil.example.com',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responds to OPTIONS preflight with 204 + CORS headers', () => {
    const { req, res, captured } = fakeReq({
      method: 'OPTIONS',
      url: '/api/state',
      origin: 'chrome-extension://godmaogbmafekfmonphpolmgkdhopcll',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(204);
    expect(captured.headers['access-control-allow-origin']).toBe('chrome-extension://godmaogbmafekfmonphpolmgkdhopcll');
    expect(captured.headers['access-control-allow-methods']).toContain('GET');
  });
});

describe('handleDiagRequest — mutating endpoints reject CORS', () => {
  it('POST /api/restart returns 200 but WITHOUT CORS header (extensions cannot trigger)', () => {
    const { req, res, captured } = fakeReq({
      method: 'POST',
      url: '/api/restart',
      origin: 'chrome-extension://godmaogbmafekfmonphpolmgkdhopcll',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('POST /api/reload-extension returns 200 but WITHOUT CORS header', () => {
    const { req, res, captured } = fakeReq({
      method: 'POST',
      url: '/api/reload-extension',
      origin: 'chrome-extension://godmaogbmafekfmonphpolmgkdhopcll',
    });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(captured.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('handleDiagRequest — targeted browser reload', () => {
  it('POST /api/reload-extension WITHOUT browserId calls hook with no arg (broadcast)', () => {
    const onReload = vi.fn(() => ({ broadcastTo: 3 }));
    const { req, res, captured } = fakeReq({
      method: 'POST',
      url: '/api/reload-extension',
    });
    handleDiagRequest(req, res, makeHooks({ onReloadExtensionRequest: onReload }));
    expect(onReload).toHaveBeenCalledWith(undefined);
    expect(captured.statusCode).toBe(200);
    const body = JSON.parse(captured.body);
    expect(body.message).toContain('3 extensions');
  });

  it('POST /api/reload-extension?browserId=X passes browserId to hook', () => {
    const onReload = vi.fn((id?: string) => ({ broadcastTo: 1, matchedBrowserId: id }));
    const { req, res, captured } = fakeReq({
      method: 'POST',
      url: '/api/reload-extension?browserId=chrome%3Aabc-123',
    });
    handleDiagRequest(req, res, makeHooks({ onReloadExtensionRequest: onReload }));
    expect(onReload).toHaveBeenCalledWith('chrome:abc-123');
    expect(captured.statusCode).toBe(200);
    const body = JSON.parse(captured.body);
    expect(body.message).toContain('chrome:abc-123');
  });

  it('POST /api/reload-extension?browserId=X with no matching extension reports correctly', () => {
    const onReload = vi.fn(() => ({ broadcastTo: 0 }));
    const { req, res, captured } = fakeReq({
      method: 'POST',
      url: '/api/reload-extension?browserId=ghost%3A999',
    });
    handleDiagRequest(req, res, makeHooks({ onReloadExtensionRequest: onReload }));
    const body = JSON.parse(captured.body);
    expect(body.message).toContain('No extension connected');
    expect(body.message).toContain('ghost:999');
  });
});

describe('handleDiagRequest — endpoint shapes', () => {
  it('GET /api/state returns bridge + browsers + mcpClients + recentRequests + recentRejections', () => {
    const { req, res, captured } = fakeReq({ url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    const body = JSON.parse(captured.body);
    expect(body.bridge.version).toBe('0.5.10');
    expect(body.bridge.pid).toBe(12345);
    expect(Array.isArray(body.browsers)).toBe(true);
    expect(Array.isArray(body.mcpClients)).toBe(true);
    expect(Array.isArray(body.recentRequests)).toBe(true);
    expect(Array.isArray(body.recentRejections)).toBe(true);
  });

  it('GET /api/logs without file param returns 400', () => {
    const { req, res, captured } = fakeReq({ url: '/api/logs' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(400);
  });

  it('GET /api/logs with invalid file param returns 400', () => {
    const { req, res, captured } = fakeReq({ url: '/api/logs?file=evil' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(400);
  });

  it('GET /api/logs with valid file returns 200 + empty lines (file does not exist)', () => {
    const { req, res, captured } = fakeReq({ url: '/api/logs?file=bridge' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(JSON.parse(captured.body).lines).toEqual([]);
  });

  it('GET / returns the diag HTML page', () => {
    const { req, res, captured } = fakeReq({ url: '/' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toContain('AgentHub');
    expect(captured.body).toContain('<!doctype html>');
  });

  it('Unknown /api/* path returns 404', () => {
    const { req, res, captured } = fakeReq({ url: '/api/does-not-exist' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.statusCode).toBe(404);
  });
});

describe('handleDiagRequest — security headers', () => {
  it('always sets X-Frame-Options: DENY on JSON responses', () => {
    const { req, res, captured } = fakeReq({ url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.headers['x-frame-options']).toBe('DENY');
  });

  it('always sets X-Content-Type-Options: nosniff on JSON responses', () => {
    const { req, res, captured } = fakeReq({ url: '/api/state' });
    handleDiagRequest(req, res, makeHooks());
    expect(captured.headers['x-content-type-options']).toBe('nosniff');
  });
});
