/**
 * Diagnostics HTTP server.
 *
 * Shares the same port as the WS server (7483). When a request arrives on
 * the HTTP path it serves the embedded UI or one of the /api/* endpoints.
 * WebSocket upgrade requests still go through the WS handler as before.
 *
 * All endpoints are LOCALHOST-ONLY:
 *   - The TCP server is bound to 127.0.0.1
 *   - Mutating endpoints (/api/restart, /api/reload-extension) ALSO check
 *     that the request's remote address is loopback as a defense-in-depth
 *     layer (in case a future change accidentally exposes the port).
 *
 * Response envelope for all JSON endpoints:
 *   { ok: true,  data:    ... }
 *   { ok: false, message: '...' }
 *
 * Endpoints
 * =========
 *   GET  /                                  → diag-page HTML
 *   GET  /api/state                         → bridge + browsers + mcpClients + recentRequests + recentRejections
 *   GET  /api/logs?file=bridge|extension|helper&n=200&search=foo
 *                                            → { lines: [string, ...] }
 *   POST /api/restart                       → exits the bridge cleanly; autostart respawns
 *   POST /api/reload-extension              → broadcasts {type:'reload'} to every connected extension WS
 *
 * Failure modes
 * =============
 *   - Endpoint unknown → 404 JSON
 *   - Localhost check fails → 403 JSON
 *   - Log file missing → 200 with empty lines (treat as "not produced yet")
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { DIAG_HTML } from './diag-page.js';

export type RecentRequestStatus = 'pending' | 'success' | 'error' | 'timeout';
export interface RecentRequest {
  mcpId: string | number | null;
  clientId: string;
  browserBoundId: string;
  browserId: string;
  tool: string;
  status: RecentRequestStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage?: string;
}

export interface RecentRejection {
  origin: string;
  reason: string;
  lastSeenAt: string;
  count: number;
}

/**
 * Bounded ring buffer of recent requests for the diag-page timeline.
 * Keeps last 50; oldest evicted when full. Read-only after construction
 * (mutations go through dedicated `mark*` methods).
 */
export class RecentActivity {
  private buf: RecentRequest[] = [];
  private rejections = new Map<string, RecentRejection>();
  private readonly MAX = 50;

  startRequest(input: Omit<RecentRequest, 'startedAt' | 'finishedAt' | 'durationMs' | 'status'>): void {
    const rec: RecentRequest = {
      ...input,
      status: 'pending',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
    };
    this.buf.push(rec);
    while (this.buf.length > this.MAX) this.buf.shift();
  }

  finishRequest(browserBoundId: string, status: 'success' | 'error' | 'timeout', errorMessage?: string): void {
    const rec = this.buf.find((r) => r.browserBoundId === browserBoundId);
    if (!rec) return;
    rec.status = status;
    rec.finishedAt = new Date().toISOString();
    rec.durationMs = Date.parse(rec.finishedAt) - Date.parse(rec.startedAt);
    if (errorMessage) rec.errorMessage = errorMessage;
  }

  noteRejection(origin: string, reason: string): void {
    const key = origin + '|' + reason;
    const existing = this.rejections.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeenAt = new Date().toISOString();
    } else {
      this.rejections.set(key, { origin, reason, lastSeenAt: new Date().toISOString(), count: 1 });
    }
  }

  snapshot(): { requests: RecentRequest[]; rejections: RecentRejection[] } {
    return {
      requests: this.buf.slice(),
      // Most recent first, cap at 10 entries
      rejections: Array.from(this.rejections.values())
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .slice(0, 10),
    };
  }
}

export interface StateSource {
  bridge: {
    version: string;
    buildId: string;
    pid: number;
    port: number;
    uptimeSec: number;
    startedBy: string;
    allowedExtensionIdsCount: number;
    allowedExtensionIdsSample: string[];
  };
  browsers: Array<{ browserId: string; connectedAt: string }>;
  mcpClients: Array<{ clientId: string; transport: string; connectedAt: string }>;
  recentActivity: RecentActivity;
}

export interface DiagServerHooks {
  /** Called by POST /api/restart. Should exit the process; autostart will respawn. */
  onRestartRequest(): void;
  /** Called by POST /api/reload-extension. Broadcasts {type:'reload'} via WS. */
  onReloadExtensionRequest(): { broadcastTo: number };
  /** Snapshot of current state for /api/state. */
  getState(): StateSource;
  /** Absolute paths of the three log files. */
  logPaths(): { bridge: string; extension: string; helper: string };
}

const LOCALHOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return LOCALHOST_ADDRS.has(addr);
}

function respondJson(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    // Prevent the diag UI from being framed by a malicious page in a browser
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

function respondHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-cache, no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
  });
  res.end(body);
}

function tailLines(filePath: string, n: number): string[] {
  if (!existsSync(filePath)) return [];
  // For most logs (< 1 MB cap), a full read is faster than seeking from
  // the end. The file is rotated when it exceeds 1 MB anyway, so worst-case
  // we read 1 MB once per request. Acceptable for an admin diag page.
  try {
    const sz = statSync(filePath).size;
    if (sz === 0) return [];
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export function handleDiagRequest(
  req: IncomingMessage,
  res: ServerResponse,
  hooks: DiagServerHooks,
): boolean {
  // Defense in depth: even though we bind to 127.0.0.1 only, double-check
  // the request came from loopback before serving anything. Returning false
  // here means "not handled — let WS / next handler try."
  if (!isLocalhost(req)) {
    respondJson(res, 403, { ok: false, message: 'localhost only' });
    return true;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // GET / → diagnostics UI
  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    respondHtml(res, DIAG_HTML);
    return true;
  }

  // GET /api/state
  if (method === 'GET' && path === '/api/state') {
    const s = hooks.getState();
    const { requests, rejections } = s.recentActivity.snapshot();
    respondJson(res, 200, {
      bridge: s.bridge,
      browsers: s.browsers,
      mcpClients: s.mcpClients,
      recentRequests: requests,
      recentRejections: rejections,
    });
    return true;
  }

  // GET /api/logs?file=&n=&search=
  if (method === 'GET' && path === '/api/logs') {
    const file = url.searchParams.get('file');
    const n = Math.min(1000, parseInt(url.searchParams.get('n') ?? '200', 10) || 200);
    const paths = hooks.logPaths();
    let p: string | null = null;
    if (file === 'bridge') p = paths.bridge;
    else if (file === 'extension') p = paths.extension;
    else if (file === 'helper') p = paths.helper;
    if (!p) {
      respondJson(res, 400, { ok: false, message: 'file must be one of: bridge, extension, helper' });
      return true;
    }
    respondJson(res, 200, { lines: tailLines(p, n) });
    return true;
  }

  // POST /api/restart
  if (method === 'POST' && path === '/api/restart') {
    respondJson(res, 200, { ok: true, message: 'Restarting bridge…' });
    // Give the response time to flush before we exit
    setTimeout(() => hooks.onRestartRequest(), 250);
    return true;
  }

  // POST /api/reload-extension
  if (method === 'POST' && path === '/api/reload-extension') {
    const result = hooks.onReloadExtensionRequest();
    respondJson(res, 200, {
      ok: true,
      message: result.broadcastTo === 0
        ? 'No extensions connected — nothing to reload'
        : `Reload signal sent to ${result.broadcastTo} extension${result.broadcastTo === 1 ? '' : 's'}`,
    });
    return true;
  }

  // 404 for any other /api/* path
  if (path.startsWith('/api/')) {
    respondJson(res, 404, { ok: false, message: 'unknown endpoint' });
    return true;
  }

  // Not an HTTP-handled path — return false so the caller knows we didn't
  // respond and can fall through (in our case there's no fallthrough; this
  // is just future-proofing).
  return false;
}
