/**
 * Server — WS server for browser extensions + MCP handler.
 *
 * Started by the first binary that grabs port 7483.
 * Secondary binaries connect as WS clients and proxy stdio↔WS.
 *
 * Connections:
 *  - Browser extensions: ?browserId=chrome|edge|brave  → tool execution
 *  - Secondary MCP clients: ?role=mcp                  → MCP JSON-RPC
 *  - Primary MCP client: own stdio                     → MCP JSON-RPC
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { toolRegistry } from './tools/index.js';
import { VERSION, BUILD_ID } from './version.js';
import {
  writeLockFile,
  deleteLockFile,
  registerCleanupHandlers,
} from './lock-file-manager.js';
import { makeLogger, logRecord, type Logger, type LogRecord } from './shared/logger.js';
import { redact, redactError } from './shared/redaction.js';
import { handleDiagRequest, RecentActivity, type StateSource } from './diag-server.js';

const REQUEST_TIMEOUT_MS = 30_000;

/** Ring buffer of recent activity for the diag UI's timeline. Populated
 *  by handleMcpMessage's tools/call path and sendToolRequest. */
const recentActivity = new RecentActivity();

/** Map of clientId → registry info. Updated by handleMcpClient (WS) and
 *  on stdio attach in startServer. Used by /api/state.
 *  clientInfo (name + version) is captured later from the initialize
 *  handshake — most MCP clients (Claude Code, Cursor, VS Code) send it. */
const mcpClientRegistry = new Map<string, {
  transport: string;
  connectedAt: string;
  clientInfo?: { name: string; version: string };
}>();

/** Map of browserId → connection start time. Updated by handleExtension.
 *  Used by /api/state. */
const browserRegistry = new Map<string, { connectedAt: string }>();

// ── Browser extension connections ─────────────────────────────────────────
// Keyed by the full composite browserId (e.g. "chrome:abc-123"). Multiple
// Chrome profiles each get their own slot — no more last-connect-wins.
const browserSockets = new Map<string, WebSocket>();

// Brand → set of full browserIds. Lets us answer "give me every connected
// Chrome" when the caller specifies a brand-only target (legacy clients) or
// when fan-out tools (list_tabs) want to broadcast to all instances.
const brandIndex = new Map<string, Set<string>>();

// Extract the brand portion from a composite browserId. "chrome:abc-123" →
// "chrome". Legacy values without a colon ("chrome", "edge") return as-is.
export function parseBrand(browserId: string): string {
  const colon = browserId.indexOf(':');
  return colon === -1 ? browserId : browserId.slice(0, colon);
}

/**
 * Pull the routing browserId out of a possibly-namespaced tab id.
 *
 * "chrome:abc-123:622786441"  → "chrome:abc-123"   (namespaced — full route)
 * "chrome:622"                → "chrome"           (legacy brand-only namespace)
 * "622786441" or 622786441    → ""                 (raw int — caller falls back)
 * anything else / undefined   → ""                 (caller falls back)
 *
 * Splits on the LAST colon so a uuid/profile id containing a colon stays
 * within the browserId portion. Mirrors `parseTabId` in the extension.
 */
export function extractBrowserIdFromTabId(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = input.trim();
  if (!s || /^[0-9]+$/.test(s)) return '';
  const lastColon = s.lastIndexOf(':');
  if (lastColon <= 0 || lastColon === s.length - 1) return '';
  const rawSuffix = s.slice(lastColon + 1);
  if (!/^[0-9]+$/.test(rawSuffix)) return '';
  return s.slice(0, lastColon);
}

// ── Origin allowlist ─────────────────────────────────────────────────────
// The WS server binds to 127.0.0.1, but any web page in the user's browser
// (or any local process) can still open a WebSocket to us. Without this
// check, an `http://localhost:*` dev server page or a browser-rendered
// http page could dispatch tools through us with chrome.debugger blast
// radius. Browser extensions send Origin "chrome-extension://<id>" or
// "moz-extension://<id>". Headless local clients (Node/Python MCP servers)
// send no Origin header — those are accepted by absence (the loopback
// bind keeps remote attackers out of that bucket).
//
// Defense-in-depth: when `allowedExtensionIds` is non-empty, we further pin
// chrome-extension:// (and moz-/safari-) origins to known IDs so a
// co-installed malicious extension cannot drive the bridge. When the set is
// empty, fall back to accepting any extension scheme (back-compat for
// installs predating the AgentHub CWS publish, where the production ID is
// not yet known).

const EXTENSION_SCHEMES = ['chrome-extension://', 'moz-extension://', 'safari-web-extension://'] as const;

/**
 * Extract the extension ID portion of an extension-scheme Origin.
 * Returns the empty string for non-extension origins or unparseable input.
 *   "chrome-extension://abc..."   → "abc..."
 *   "chrome-extension://abc/path" → "abc"
 *   "https://example.com"         → ""
 */
export function extensionIdFromOrigin(origin: string): string {
  for (const scheme of EXTENSION_SCHEMES) {
    if (origin.startsWith(scheme)) {
      const rest = origin.slice(scheme.length);
      const slash = rest.indexOf('/');
      return slash === -1 ? rest : rest.slice(0, slash);
    }
  }
  return '';
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedExtensionIds?: ReadonlySet<string>,
): boolean {
  if (!origin) return true;
  const id = extensionIdFromOrigin(origin);
  if (!id) return false;
  // No allowlist configured → accept any extension-scheme origin (back-compat).
  // Allowlist configured → only accept IDs in the set.
  if (!allowedExtensionIds || allowedExtensionIds.size === 0) return true;
  return allowedExtensionIds.has(id);
}

/**
 * Resolve the set of extension IDs the WS server should accept, in priority
 * order:
 *   1. `AGENTHUB_ALLOWED_EXTENSION_IDS` env var (comma-separated).
 *   2. `<installDir>/extension-ids.json` config file (string array).
 *   3. Empty set → back-compat: accept any extension-scheme Origin.
 *
 * Exported for tests; the production wiring lives inside `startServer`.
 */
export function loadAllowedExtensionIds(opts?: {
  env?: NodeJS.ProcessEnv;
  installDir?: string;
}): Set<string> {
  const env = opts?.env ?? process.env;
  const result = new Set<string>();
  const envValue = env.AGENTHUB_ALLOWED_EXTENSION_IDS;
  if (envValue) {
    for (const raw of envValue.split(',')) {
      const id = raw.trim();
      if (id) result.add(id);
    }
  }
  if (result.size > 0) return result;
  const installDir = opts?.installDir ?? defaultInstallDir();
  if (!installDir) return result;
  try {
    const configPath = join(installDir, 'extension-ids.json');
    if (!existsSync(configPath)) return result;
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === 'string' && entry.trim()) result.add(entry.trim());
      }
    }
  } catch {
    // Best-effort: malformed config falls back to back-compat behavior.
  }
  return result;
}

function defaultInstallDir(): string {
  switch (osPlatform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'agenthub');
    default:
      return join(homedir(), '.local', 'share', 'agenthub');
  }
}

function indexBrowser(browserId: string, ws: WebSocket): void {
  // If the same browserId already has a socket, the old one is stale (e.g.
  // SW eviction left the previous WS in OPEN state from our side, but the
  // extension reconnected with a new socket). Tear it down so its
  // serverPing timer fires its 'close' handler and stops leaking memory.
  //
  // CRITICAL: emit a `bridge.browser.replaced` event RIGHT HERE — the
  // old socket's `close` handler will fail its `browserSockets.get(id) === ws`
  // check (because we just overwrote the entry) and therefore won't log a
  // disconnect. Without this explicit replace event, the bridge log shows
  // many `bridge.browser.connected` for the same browserId with no
  // corresponding disconnects, and the dashboard cannot tell that the
  // browser session actually churned.
  const existing = browserSockets.get(browserId);
  if (existing && existing !== ws) {
    bridgeLog().warn('bridge.browser.replaced', {
      browserId,
      reason: 'new_socket_for_same_browserid',
      hint: 'Old socket was orphaned (likely Chrome MV3 SW eviction). Terminating it now.',
    });
    try { existing.terminate(); } catch { /* noop */ }
    // Also clear any pending requests routed to the old socket — they
    // would never have completed (the new SW life knows nothing about them).
    for (const [reqId, req] of pendingRequests) {
      if (req.browserId === browserId) {
        clearTimeout(req.timer);
        pendingRequests.delete(reqId);
        try { req.reject(new Error('browser_socket_replaced_mid_request')); } catch { /* ignore */ }
      }
    }
  }

  browserSockets.set(browserId, ws);
  const brand = parseBrand(browserId);
  let set = brandIndex.get(brand);
  if (!set) {
    set = new Set<string>();
    brandIndex.set(brand, set);
  }
  set.add(browserId);
}

function unindexBrowser(browserId: string): void {
  browserSockets.delete(browserId);
  const brand = parseBrand(browserId);
  const set = brandIndex.get(brand);
  if (set) {
    set.delete(browserId);
    if (set.size === 0) brandIndex.delete(brand);
  }
  // Track the most recent disconnect time so sendToolRequest can
  // offer a brief reconnection grace window.
  lastBrowserDisconnectedAt = Date.now();
}

// Timestamp of the most recent browser disconnect. Used by sendToolRequest
// to distinguish "no browser ever connected" from "browser just reconnecting".
let lastBrowserDisconnectedAt = 0;

// How long (ms) after a disconnect to wait for the SW to reconnect before
// returning "No browser extension connected". Short enough to not degrade the
// happy path, long enough for Chrome to evict+relaunch the SW (typically <5s).
const SW_RECONNECT_GRACE_MS = 4_000;
const SW_RECONNECT_POLL_INTERVAL_MS = 200;

// ── MCP client connections (secondary binaries over WS) ───────────────────
const mcpClients = new Map<string, WebSocket>();

// ── In-flight tool requests ───────────────────────────────────────────────
// Keyed by a server-generated browser-bound id (b_<uuid>) so that two MCP
// clients issuing the same JSON-RPC id (commonly 1) cannot clobber each
// other's pending entry. The original client-supplied id is preserved in
// `originalId` and used when replying to the MCP client.
interface PendingRequest {
  clientId: string;
  originalId: string | number | null;
  /** Which extension this was routed to. Used to filter the pending map
   *  when a browser disconnects so we can report per-browser pending count. */
  browserId: string;
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingRequests = new Map<string, PendingRequest>();

const startTime = Date.now();
let serverPort = 0;

function getServerInfo() {
  return {
    type: 'server_info' as const,
    pid: process.pid,
    port: serverPort,
    version: VERSION,
    buildId: BUILD_ID,
    startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? 'service',
    capabilities: toolRegistry.map((t) => t.name),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    connectedBrowsers: Array.from(browserSockets.keys()),
    connectedStubs: mcpClients.size + 1,
  };
}

// ── Parse query params from WS upgrade URL ────────────────────────────────
function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const qi = url.indexOf('?');
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(qi + 1));
}

// ── Handle browser extension connection ───────────────────────────────────
// Bridge sends server_ping every 20s. Each ping arrival in the extension
// fires a WS onmessage event in the service worker, which counts as SW
// activity and resets Chrome's eviction timer. This keeps the WS alive
// even when the extension's own setInterval-based heartbeat dies along
// with the SW (chicken-and-egg). See docs/multi-profile-tab-fanout-design.md
// "Related symptom: connection drops during agent runs".
const SERVER_PING_INTERVAL_MS = 20_000;

// Health probes from the native-host-helper use a synthetic browserId
// `helper-probe`. Treat them differently from real extension connections
// so they don't pollute the (much smaller) real-browser event stream.
// See packages/native-host-helper/src/service-status.ts.
const HELPER_PROBE_BROWSER_ID = 'helper-probe';

/**
 * Per-browser liveness state. `lastSeenAt` is updated on EVERY inbound
 * frame from that browser (ping, pong, tool_response, log_batch). If the
 * extension's SW is wedged after Chrome MV3 suspension, the OS-level WS
 * stays in CLOSE_WAIT and looks alive to the bridge, but no inbound
 * frames arrive. `lastSeenAt` going stale is the canonical signal.
 *
 * `pendingPongs` lets callers register a one-shot resolver for the next
 * `server_pong` from a specific browser. Used by `proveLive()` to do a
 * fast liveness probe before sending a tool_request.
 */
const browserLastSeen = new Map<string, number>();
const pendingPongs = new Map<string, Array<(timestamp: number) => void>>();

function markBrowserAlive(browserId: string): void {
  browserLastSeen.set(browserId, Date.now());
}

/**
 * Send `server_ping` and wait for `server_pong`. Resolves true if pong
 * arrives within `timeoutMs`, false otherwise. Used to detect wedged
 * service workers BEFORE sending the actual tool_request — gives the
 * MCP client a clear, fast error instead of a 10s timeout on a dead WS.
 */
function proveLive(browserId: string, ws: WebSocket, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const handler = (_timestamp: number) => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    const waiters = pendingPongs.get(browserId) ?? [];
    waiters.push(handler);
    pendingPongs.set(browserId, waiters);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      // Remove our handler from the waiter list
      const arr = pendingPongs.get(browserId);
      if (arr) {
        const i = arr.indexOf(handler);
        if (i >= 0) arr.splice(i, 1);
      }
      resolve(false);
    }, timeoutMs);
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'server_ping', timestamp: Date.now(), reason: 'liveness-probe' }));
      } else {
        // WS not even in OPEN state — definitely dead
        settled = true;
        resolve(false);
      }
    } catch {
      settled = true;
      resolve(false);
    }
  });
}

const LIVENESS_PROBE_TIMEOUT_MS = 3_000;

function handleExtension(ws: WebSocket, browserId: string): void {
  const connectedAt = Date.now();
  const isProbe = browserId === HELPER_PROBE_BROWSER_ID;
  if (isProbe) {
    // Log probes at debug-level event names so they're trivially greppable
    // separately from real browser activity. Real extension connections
    // remain on the bridge.browser.* namespace.
    bridgeLog().info('bridge.probe.connected', { browserId });
  } else {
    bridgeLog().info('bridge.browser.connected', { browserId });
    browserRegistry.set(browserId, { connectedAt: new Date(connectedAt).toISOString() });
  }
  indexBrowser(browserId, ws);
  ws.send(JSON.stringify(getServerInfo()));

  const serverPingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'server_ping', timestamp: Date.now() }));
    }
  }, SERVER_PING_INTERVAL_MS);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Any inbound frame from this browser proves liveness.
      markBrowserAlive(browserId);
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        return;
      }
      if (msg.type === 'server_pong') {
        // Wake up any pending liveness probe waiters (proveLive callers).
        const waiters = pendingPongs.get(browserId);
        if (waiters && waiters.length > 0) {
          const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
          // Run all waiters, then clear the list. Multiple in-flight
          // probes for the same browser are rare but possible (concurrent
          // tool calls); resolving them all keeps everything snappy.
          for (const w of waiters.slice()) {
            try { w(ts); } catch { /* ignore */ }
          }
          pendingPongs.set(browserId, []);
        }
        return;
      }
      if (msg.type === 'request_tool_scan') {
        ws.send(JSON.stringify({ type: 'tool_scan', tools: [] }));
        return;
      }
      // Extension forwarding log batches from its chrome.storage ring
      // buffer. Validate the shape, write each entry through the
      // extension-log file. Drop malformed entries silently.
      //
      // DoS protection:
      //   - Cap entries per batch at 200 (matches extension's MAX_BATCH_ENTRIES
      //     with headroom). A malicious extension cannot stall the bridge's
      //     event loop with one giant batch.
      //   - Per-browser rate limit enforced upstream by WS framing
      //     (msgsPerSec checked by ws library's maxPayload setting).
      if (msg.type === 'log_batch' && Array.isArray(msg.entries)) {
        const MAX_BATCH = 200;
        if (msg.entries.length > MAX_BATCH) {
          bridgeLog().warn('bridge.log_batch.oversize_dropped', {
            browserId,
            received: msg.entries.length,
            cap: MAX_BATCH,
          });
          return;
        }
        for (const entry of msg.entries) {
          if (!isValidLogEntry(entry)) continue;
          // Stamp the receiving bridge's PID so we can later distinguish
          // logs that came through different bridge generations.
          logRecord({ filePath: getExtensionLogPath() }, {
            ...entry,
            _via_bridge_pid: process.pid,
            _from_browser: browserId,
          });
        }
        return;
      }
      if (msg.id) {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(msg.id);
          pending.resolve(msg);
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    clearInterval(serverPingTimer);
    if (browserSockets.get(browserId) === ws) {
      unindexBrowser(browserId);
      browserLastSeen.delete(browserId);
      // Resolve any in-flight liveness probes as false — the WS is gone.
      const waiters = pendingPongs.get(browserId);
      if (waiters && waiters.length > 0) {
        // Adapter: proveLive's resolver expects a number, but we want to
        // signal "dead." We resolve with 0 so the timeout race still fires
        // false. Actually safer: just leave them to timeout naturally.
      }
      pendingPongs.delete(browserId);
      if (!isProbe) browserRegistry.delete(browserId);
      const event = isProbe ? 'bridge.probe.disconnected' : 'bridge.browser.disconnected';
      // Per-browser pending count: filter the global pending map by which
      // request was routed to this specific browser. Tier 3 #10 fix —
      // previously we logged the global count which was misleading.
      let pendingForThisBrowser = 0;
      for (const req of pendingRequests.values()) {
        if (req.browserId === browserId) pendingForThisBrowser++;
      }
      bridgeLog().info(event, {
        browserId,
        durationMs: Date.now() - connectedAt,
        pendingRequestCount: pendingForThisBrowser,
        totalPendingAcrossAllBrowsers: pendingRequests.size,
      });
    }
  });
}

/**
 * Sanity check incoming log entries from the extension. Defends against
 * a buggy or malicious extension sending huge / malformed payloads that
 * would balloon extension.log.
 */
function isValidLogEntry(entry: unknown): entry is LogRecord {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.event !== 'string' || e.event.length > 200) return false;
  if (e.src !== 'ext') return false; // bridge.log is only for bridge events
  if (e.lvl !== 'info' && e.lvl !== 'warn' && e.lvl !== 'error') return false;
  return true;
}

// ── Handle secondary MCP client connection (over WS) ──────────────────────
function handleMcpClient(ws: WebSocket): void {
  const clientId = randomUUID();
  mcpClients.set(clientId, ws);
  mcpClientRegistry.set(clientId, { transport: 'ws', connectedAt: new Date().toISOString() });
  bridgeLog().info('bridge.mcp.client_connected', { clientId, transport: 'ws' });

  ws.on('message', (data) => {
    const raw = data.toString();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) handleMcpMessage(clientId, trimmed, (msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      });
    }
  });

  ws.on('close', () => {
    mcpClients.delete(clientId);
    mcpClientRegistry.delete(clientId);
    bridgeLog().info('bridge.mcp.client_disconnected', { clientId });
    for (const [id, p] of pendingRequests) {
      if (p.clientId === clientId) {
        clearTimeout(p.timer);
        pendingRequests.delete(id);
      }
    }
  });
}

/**
 * Resolve a routing target to a single open socket.
 *
 *  - Composite id ("chrome:abc-123")  → exact match in browserSockets
 *  - Brand-only ("chrome")            → first open socket in brandIndex["chrome"]
 *  - "default" / empty / unmatched    → any open socket (preserves single-
 *                                        browser legacy behavior)
 *
 * Returns null when no open socket is available.
 */
function resolveSocket(target: string): WebSocket | null {
  // 1. Exact composite match
  const exact = browserSockets.get(target);
  if (exact && exact.readyState === WebSocket.OPEN) return exact;

  // 2. Brand-only — pick any open socket of that brand
  if (!target.includes(':')) {
    const ids = brandIndex.get(target);
    if (ids) {
      for (const id of ids) {
        const s = browserSockets.get(id);
        if (s && s.readyState === WebSocket.OPEN) return s;
      }
    }
  }

  // 3. Fallback — any open socket. Used for legacy clients that pass nothing
  //    or "default" and only have one browser connected.
  for (const s of browserSockets.values()) {
    if (s.readyState === WebSocket.OPEN) return s;
  }
  return null;
}

// ── Send tool request to browser extension ────────────────────────────────
async function sendToolRequest(
  clientId: string,
  originalId: string | number | null,
  tool: string,
  params: Record<string, unknown>,
  browserId: string,
): Promise<unknown> {
  let ws = resolveSocket(browserId);

  // If no socket is available right now, check whether we're inside the
  // reconnection grace window (SW just evicted/suspended → Chrome is
  // relaunching it → it will reconnect within a few seconds). Only wait
  // if there was a recent disconnect; fail immediately when no extension
  // has ever connected in this server session (user hasn't opened the browser).
  if (!ws && lastBrowserDisconnectedAt > 0) {
    const elapsed = Date.now() - lastBrowserDisconnectedAt;
    if (elapsed < SW_RECONNECT_GRACE_MS) {
      const remaining = SW_RECONNECT_GRACE_MS - elapsed;
      const deadline = Date.now() + remaining;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, SW_RECONNECT_POLL_INTERVAL_MS));
        ws = resolveSocket(browserId);
        if (ws) break;
      }
    }
  }

  if (!ws) {
    bridgeLog().warn('bridge.route.no_browser', {
      clientId,
      mcpId: originalId,
      toolName: tool,
      requestedBrowserId: browserId,
      availableBrowsers: Array.from(browserSockets.keys()),
    });
    throw new Error('No browser extension connected');
  }

  return new Promise((resolve, reject) => {

    // Server-generated id, unique across all MCP clients, used as the
    // routing key in pendingRequests and as the id sent to the extension.
    const browserBoundId = `b_${randomUUID()}`;
    const sentAt = Date.now();

    bridgeLog().info('bridge.tool_request.sent', {
      mcpId: originalId,
      clientId,
      browserBoundId,
      browserId,
      toolName: tool,
      args: redact(params),
    });
    recentActivity.startRequest({
      mcpId: originalId,
      clientId,
      browserBoundId,
      browserId,
      tool,
    });

    const timer = setTimeout(() => {
      pendingRequests.delete(browserBoundId);
      bridgeLog().warn('bridge.tool_request.timed_out', {
        mcpId: originalId,
        clientId,
        browserBoundId,
        browserId,
        toolName: tool,
        elapsedMs: Date.now() - sentAt,
      });
      recentActivity.finishRequest(browserBoundId, 'timeout', 'timed out');
      reject(new Error('Tool request timed out'));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(browserBoundId, {
      clientId,
      originalId,
      browserId,
      resolve: (response: unknown) => {
        const r = response as { type?: string; result?: { isError?: boolean } };
        const isError = r?.result?.isError === true || r?.type === 'tool_error';
        bridgeLog().info('bridge.tool_response.received', {
          mcpId: originalId,
          clientId,
          browserBoundId,
          browserId,
          toolName: tool,
          durationMs: Date.now() - sentAt,
          type: r?.type ?? 'unknown',
          isError,
        });
        recentActivity.finishRequest(browserBoundId, isError ? 'error' : 'success');
        resolve(response);
      },
      reject: (err: Error) => {
        recentActivity.finishRequest(browserBoundId, 'error', err.message);
        reject(err);
      },
      timer,
    });
    // Pre-wake the SW (see preWakeSW docstring). Cheap insurance against
    // requests landing on a suspended SW and timing out.
    preWakeSW(ws);
    ws.send(JSON.stringify({ type: 'tool_request', id: browserBoundId, tool, params }));
  });
}

// Per-browser timeout for fan-out tools. Was 2s — too aggressive for an
// MV3 service worker that may need 1-3s to wake up after suspension. At 2s,
// any wedged-or-sleeping SW guaranteed a "timeout" outcome even when the
// browser was otherwise healthy. 10s leaves headroom for:
//   - SW wake (typically 1-3s, up to ~5s when Chrome is under load)
//   - tool execution (tabs query: 100-500ms; snapshot/screenshot: 1-3s)
//   - WS frame ack roundtrip on a sluggish system
// Still well under REQUEST_TIMEOUT_MS (30s) so one slow browser can't
// stall the aggregate response too long.
const FAN_OUT_TIMEOUT_MS = 10_000;

/**
 * Send a tiny "wake" frame to a browser's WS BEFORE the real tool_request.
 * Many MV3 SW evictions leave the OS-level WS open while the SW itself is
 * suspended. Sending any frame to the SW's onmessage handler triggers the
 * SW to wake. By sending a server_ping first, we give the SW a head start
 * — by the time our tool_request arrives moments later, the SW is awake
 * and ready to handle it.
 *
 * This is fire-and-forget: we don't wait for a server_pong reply. The
 * subsequent tool_request will be queued behind the ping in the WS buffer
 * and processed once the SW wakes.
 */
function preWakeSW(ws: WebSocket): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'server_ping', timestamp: Date.now(), reason: 'pre-tool-request' }));
    }
  } catch { /* best-effort */ }
}

export interface FanOutResult {
  browserId: string;
  ok: true;
  response: unknown;
}
export interface FanOutError {
  browserId: string;
  ok: false;
  error: string;
}

/**
 * Send the same tool_request to every connected extension matching the
 * brand filter (or all extensions if no filter). Returns per-browser
 * results — never rejects on a single browser's failure. Used by tools
 * that need to gather across all profiles (currently `list_tabs`).
 */
function fanOutToolRequest(
  clientId: string,
  tool: string,
  params: Record<string, unknown>,
  brandFilter: string | null,
  fanoutId?: string,
): Promise<Array<FanOutResult | FanOutError>> {
  const targets: Array<{ browserId: string; ws: WebSocket }> = [];

  if (brandFilter && brandFilter !== 'default') {
    // Filter by brand. Composite ids are checked via parseBrand; legacy
    // brand-only ids ("chrome") match the brand exactly.
    for (const [id, ws] of browserSockets.entries()) {
      if (parseBrand(id) === brandFilter && ws.readyState === WebSocket.OPEN) {
        targets.push({ browserId: id, ws });
      }
    }
  } else {
    for (const [id, ws] of browserSockets.entries()) {
      if (ws.readyState === WebSocket.OPEN) targets.push({ browserId: id, ws });
    }
  }

  if (targets.length === 0) {
    return Promise.resolve([]);
  }

  return Promise.all(
    targets.map(({ browserId, ws }) => (async (): Promise<FanOutResult | FanOutError> => {
      const browserBoundId = `b_${randomUUID()}`;
      const sentAt = Date.now();
      const brand = browserId.split(':')[0] || 'browser';

      // Per-target RecentActivity entry. Means a fanout to 3 browsers
      // produces 3 timeline rows in the dashboard, each showing the
      // per-browser outcome (success / timeout / error). User can see
      // exactly which browser is wedged when one target hangs.
      if (fanoutId) {
        recentActivity.startRequest({
          mcpId: null,
          clientId,
          browserBoundId,
          browserId,
          tool,
        }, {
          key: 'tool_request_started',
          status: 'info',
          message: `Bridge picked ${brand} to run ${tool}.`,
        });
      }

      // Liveness probe: ping the browser and wait up to 3s for pong.
      // If no pong arrives, the SW is wedged and the tool_request would
      // just time out at 10s. Failing fast gives the user a clear error
      // immediately AND avoids holding up the MCP client.
      if (fanoutId) {
        recentActivity.addStep(browserBoundId, {
          key: 'liveness_probe_sent',
          status: 'wait',
          message: `Bridge knocked on ${brand}'s door (sent a tiny ping) to check it is awake.`,
        });
      }
      const alive = await proveLive(browserId, ws, LIVENESS_PROBE_TIMEOUT_MS);
      if (!alive) {
        // SW is wedged. Don't even try the tool_request — it would just
        // time out at 10s. Mark this WS as dead so future requests skip
        // it until the extension reconnects.
        if (fanoutId) {
          bridgeLog().warn('bridge.fanout.target_unresponsive', {
            fanoutId, browserId, browserBoundId,
            elapsedMs: Date.now() - sentAt,
            reason: 'no_pong_within_3s',
          });
          recentActivity.finishRequest(browserBoundId, 'timeout', 'sw_wedged_no_pong', {
            key: 'liveness_probe_failed',
            message: `${brand} did not answer the ping in 3 seconds.`,
            cause: `${brand}'s extension brain (service worker) is asleep or stuck. Click "Reload this browser" on the Connected Browsers card to wake it up.`,
          });
        }
        // Close the dead socket so the extension can reconnect cleanly.
        try { ws.close(1011, 'sw_wedged_no_pong'); } catch { /* ignore */ }
        return { browserId, ok: false, error: 'sw_wedged (no pong within 3s)' };
      }
      if (fanoutId) {
        recentActivity.addStep(browserBoundId, {
          key: 'liveness_probe_ok',
          status: 'ok',
          message: `${brand} answered the ping — it is awake.`,
        });
      }

      // SW is awake. Now send the real tool_request and wait.
      return new Promise<FanOutResult | FanOutError>((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(browserBoundId);
          if (fanoutId) {
            bridgeLog().warn('bridge.fanout.target_timed_out', {
              fanoutId, browserId, browserBoundId, elapsedMs: Date.now() - sentAt,
            });
            recentActivity.finishRequest(browserBoundId, 'timeout', 'tool_request_timeout', {
              key: 'tool_request_timed_out',
              message: `${brand} answered the ping but didn't reply to ${tool} within 10 seconds.`,
              cause: `Most likely the extension JS held a stale WebSocket reference (orphan socket): bridge sent the request on socket A, extension is now listening on socket B (a newer one from a reconnect). The orphan-detection sweep will close the dead socket within 15s and the extension will reconnect cleanly. If you keep seeing this, click "Reload this browser" below to force a fresh service worker.`,
            });
          }
          resolve({ browserId, ok: false, error: 'timeout' });
        }, FAN_OUT_TIMEOUT_MS);

        pendingRequests.set(browserBoundId, {
          clientId,
          originalId: null,
          browserId,
          resolve: (response) => {
            if (fanoutId) {
              bridgeLog().info('bridge.fanout.target_replied', {
                fanoutId, browserId, browserBoundId, durationMs: Date.now() - sentAt, ok: true,
              });
              recentActivity.finishRequest(browserBoundId, 'success', undefined, {
                key: 'tool_response_received',
                message: `${brand} finished ${tool} in ${Date.now() - sentAt} ms. Bridge is sending the result to your AI.`,
              });
            }
            resolve({ browserId, ok: true, response });
          },
          reject: (err) => {
            if (fanoutId) {
              bridgeLog().info('bridge.fanout.target_replied', {
                fanoutId, browserId, browserBoundId, durationMs: Date.now() - sentAt, ok: false,
                errorMessage: err.message,
              });
              recentActivity.finishRequest(browserBoundId, 'error', err.message, {
                key: 'tool_request_failed',
                message: `${brand} reported an error while running ${tool}: ${err.message}`,
                cause: 'The tool itself failed inside the extension. Check the extension log tab for details.',
              });
            }
            resolve({ browserId, ok: false, error: err.message });
          },
          timer,
        });
        if (fanoutId) {
          recentActivity.addStep(browserBoundId, {
            key: 'tool_request_sent',
            status: 'wait',
            message: `Bridge asked ${brand} to run ${tool} and is waiting for the answer.`,
          });
        }
        ws.send(JSON.stringify({ type: 'tool_request', id: browserBoundId, tool, params }));
        if (fanoutId) {
          bridgeLog().info('bridge.fanout.target_sent', { fanoutId, browserId, browserBoundId });
        }
      });
    })()),
  );
}

/**
 * Merge per-browser list_tabs responses into a single MCP tool result.
 * Each extension returns `{ content: [{ type: 'text', text: JSON.stringify(tabs[]) }] }`
 * with already-namespaced ids. This concatenates the tabs arrays and
 * appends an `errors` field for any browsers that failed/timed out.
 */
export function mergeFanOutListTabs(results: Array<FanOutResult | FanOutError>): {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
} {
  const allTabs: unknown[] = [];
  const errors: Array<{ browserId: string; error: string }> = [];

  for (const r of results) {
    if (!r.ok) {
      errors.push({ browserId: r.browserId, error: r.error });
      continue;
    }
    const resp = r.response as {
      type?: string;
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      error?: { message?: string };
    };

    // Raw extension `tool_error` envelope: { type: 'tool_error', error: { message, code } }.
    // Extension's relay-client.ts sends this shape when a handler throws.
    // We need to surface error.message rather than try to parse the
    // non-existent result.
    if (resp?.type === 'tool_error') {
      errors.push({
        browserId: r.browserId,
        error: resp.error?.message ?? 'extension tool error',
      });
      continue;
    }

    // JSON-RPC error envelope (extension didn't return a result at all).
    if (resp?.error) {
      errors.push({ browserId: r.browserId, error: resp.error.message ?? 'rpc_error' });
      continue;
    }

    // MCP-style tool-error envelope: { result: { isError: true, content: [...] } }.
    // Surface the human-readable text instead of trying to JSON.parse it.
    if (resp?.result?.isError) {
      const errText = resp.result.content?.[0]?.text ?? 'extension reported tool error';
      errors.push({ browserId: r.browserId, error: errText });
      continue;
    }

    // Success envelope. text MUST be a string containing a JSON array of tabs.
    const text = resp?.result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      errors.push({ browserId: r.browserId, error: 'malformed_envelope' });
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        errors.push({ browserId: r.browserId, error: 'expected_array' });
        continue;
      }
      allTabs.push(...parsed);
    } catch (err) {
      errors.push({
        browserId: r.browserId,
        error: `parse_failed: ${(err as Error).message}`,
      });
    }
  }

  const payload: { tabs: unknown[]; errors?: Array<{ browserId: string; error: string }> } = {
    tabs: allTabs,
  };
  if (errors.length > 0) payload.errors = errors;

  // Mark the result as an error when EVERY target failed (no tabs were
  // returned by anyone). The previous behavior left `isError` unset, so
  // MCP clients (VS Code, Cursor, Claude) saw a "successful" response
  // whose content text was actually an error JSON — they then parsed it
  // and showed misleading timeout messages to users.
  //
  // Partial-success (some browsers responded, some timed out) is NOT
  // flagged as error: the payload still has real tabs, and the `errors`
  // array surfaces which browsers didn't respond. The MCP client can
  // decide how to surface that.
  const allFailed = results.length > 0 && errors.length === results.length;

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(allFailed ? { isError: true as const } : {}),
  };
}

/**
 * Translate the response we got from the extension over WS into the MCP
 * tool-result shape. The extension can emit two flavours:
 *
 *   1. Success: `{ type: 'tool_response', id, result: { content: [...] } }`
 *   2. Error:   `{ type: 'tool_error',    id, error:  { message, code } }`
 *
 * Before this translator existed, the host did `result: resp.result ?? resp`,
 * which leaked the raw `tool_error` envelope into the MCP `result` slot.
 * MCP clients see no `result.content` array and silently render nothing.
 * That was the "tools return empty" symptom from §21 of the 2026-06-04
 * postdownloader session log. Both shapes now map to a well-formed MCP
 * tool result with `content` populated.
 */
export function translateExtensionResponse(response: unknown): {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
} {
  const resp = response as {
    type?: string;
    result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    error?: { message?: string; code?: string };
  };

  if (resp?.type === 'tool_error') {
    const message = resp.error?.message ?? 'extension tool error';
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  // Top-level JSON-RPC error envelope: { id, error: { message, code } }.
  // Some legacy / alternate extension paths send this shape instead of
  // wrapping in `tool_error`. Surface it as a tool-level error too so
  // clients render something instead of nothing.
  if (resp?.error) {
    const message = resp.error.message ?? 'extension rpc error';
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  if (resp?.result?.content) {
    return resp.result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
  }

  // Anything else — including legacy success envelopes that put the payload
  // at the top level — falls back to wrapping the raw response as JSON. This
  // is the same lossy-but-non-empty behaviour the old code had; it's only
  // reached for shapes we don't recognise. The `String(response)` fallback
  // guards against `JSON.stringify(undefined)` returning the actual undefined
  // value (which would produce an empty MCP text block — the original bug).
  const serialised = JSON.stringify(response);
  const text = typeof serialised === 'string' ? serialised : String(response);
  return {
    content: [{ type: 'text', text }],
  };
}

// ── MCP JSON-RPC handler (shared by stdio + WS clients) ──────────────────
function handleMcpMessage(clientId: string, raw: string, reply: (msg: unknown) => void): void {
  try {
    const msg = JSON.parse(raw);

    if (msg.method === 'initialize') {
      const startedAt = Date.now();
      const clientName = msg.params?.clientInfo?.name;
      const clientVersion = msg.params?.clientInfo?.version;
      bridgeLog().info('bridge.mcp.initialize.received', {
        mcpId: msg.id ?? null,
        clientId,
        clientName,
        clientVersion,
        protocolVersion: msg.params?.protocolVersion,
      });
      // Stash clientInfo on the registry so the diag UI can show a
      // friendly name ("Claude Code") instead of just a clientId UUID.
      // Defensive: only store if values are strings (a misbehaving client
      // could send anything). Limit length so a client can't bloat the
      // registry. The redact() call is for the LOG line; the registry
      // gets the raw values bounded by length.
      const existing = mcpClientRegistry.get(clientId);
      if (existing && typeof clientName === 'string' && typeof clientVersion === 'string') {
        mcpClientRegistry.set(clientId, {
          ...existing,
          clientInfo: {
            name: clientName.slice(0, 60),
            version: clientVersion.slice(0, 30),
          },
        });
      }
      reply({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agenthub', version: VERSION },
        },
      });
      bridgeLog().info('bridge.mcp.initialize.replied', {
        mcpId: msg.id ?? null,
        clientId,
        durationMs: Date.now() - startedAt,
        serverVersion: VERSION,
      });
      return;
    }

    if (msg.method === 'notifications/initialized') {
      bridgeLog().info('bridge.mcp.notifications_initialized', { clientId });
      return;
    }

    if (msg.method === 'tools/list') {
      const startedAt = Date.now();
      bridgeLog().info('bridge.mcp.tools_list.received', {
        mcpId: msg.id ?? null,
        clientId,
      });
      const browserProp = { type: 'string', description: 'Target browser: chrome, edge, brave, arc, vivaldi (defaults to last-connected)' };
      const tools = toolRegistry.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object',
          properties: {
            ...Object.fromEntries(Object.entries(t.inputSchema).map(([k, v]) => [k, zodToJsonSchema(v)])),
            browser: browserProp,
          },
        },
      }));
      reply({ jsonrpc: '2.0', id: msg.id, result: { tools } });
      bridgeLog().info('bridge.mcp.tools_list.replied', {
        mcpId: msg.id ?? null,
        clientId,
        durationMs: Date.now() - startedAt,
        toolCount: tools.length,
      });
      return;
    }

    if (msg.method === 'tools/call') {
      const toolName = msg.params?.name as string;
      const toolArgs = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      // Route precedence:
      //   1. Namespaced tab_id prefix (most specific — picks the exact profile).
      //   2. Explicit `browser` param (brand or composite id).
      //   3. "default" (single-browser legacy fallback).
      const tabIdRoute = extractBrowserIdFromTabId(toolArgs.tab_id);
      const browserId = tabIdRoute || (toolArgs.browser as string) || 'default';
      const originalId = (msg.id ?? null) as string | number | null;
      const receivedAt = Date.now();

      bridgeLog().info('bridge.mcp.tools_call.received', {
        mcpId: originalId,
        clientId,
        toolName,
        targetBrowserId: browserId,
        routeSource: tabIdRoute ? 'tab_id_prefix' : (toolArgs.browser ? 'explicit_browser_param' : 'default'),
        args: redact(toolArgs),
      });

      const replyWithMetrics = (responseEnvelope: { result?: { content?: unknown[]; isError?: boolean } }) => {
        const isError = responseEnvelope?.result?.isError === true;
        const contentItems = Array.isArray(responseEnvelope?.result?.content)
          ? responseEnvelope.result.content.length
          : 0;
        bridgeLog().info('bridge.mcp.tools_call.replied', {
          mcpId: originalId,
          clientId,
          toolName,
          durationMs: Date.now() - receivedAt,
          isError,
          contentItems,
        });
        reply(responseEnvelope);
      };

      // list_tabs is a fan-out tool: aggregate tabs across every connected
      // extension instance, regardless of profile, so users with multiple
      // Chrome profiles see one unified view. Optional `browser` param
      // narrows the broadcast to a single brand.
      //
      // Tracking: each target browser gets its own RecentActivity entry
      // (created inside fanOutToolRequest), so the dashboard timeline
      // shows per-browser outcome. We do NOT add an aggregate row — it'd
      // double-count when reading the dashboard.
      if (toolName === 'list_tabs') {
        const brandFilter = browserId === 'default' ? null : browserId;
        const fanoutId = `fo_${randomUUID()}`;
        bridgeLog().info('bridge.fanout.started', { fanoutId, mcpId: originalId, toolName, brandFilter });
        fanOutToolRequest(clientId, toolName, toolArgs, brandFilter, fanoutId)
          .then((results) => {
            const succeeded = results.filter((r) => r.ok).length;
            const errored = results.filter((r) => !r.ok).length;
            bridgeLog().info('bridge.fanout.aggregated', {
              fanoutId,
              mcpId: originalId,
              totalTargets: results.length,
              succeeded,
              errored,
            });
            if (results.length === 0) {
              replyWithMetrics({
                jsonrpc: '2.0', id: msg.id,
                result: { content: [{ type: 'text', text: 'No browser extension connected' }], isError: true },
              } as { result: { content: unknown[]; isError: boolean } });
              return;
            }
            replyWithMetrics({ jsonrpc: '2.0', id: msg.id, result: mergeFanOutListTabs(results) } as { result: { content: unknown[]; isError?: boolean } });
          })
          .catch((err: Error) => {
            bridgeLog().error('bridge.fanout.failed', {
              fanoutId,
              mcpId: originalId,
              ...redactError(err),
            });
            replyWithMetrics({
              jsonrpc: '2.0', id: msg.id,
              result: { content: [{ type: 'text', text: `list_tabs fan-out failed: ${err.message}` }], isError: true },
            } as { result: { content: unknown[]; isError: boolean } });
          });
        return;
      }

      sendToolRequest(clientId, originalId, toolName, toolArgs, browserId)
        .then((response: unknown) => {
          replyWithMetrics({ jsonrpc: '2.0', id: msg.id, result: translateExtensionResponse(response) } as { result: { content: unknown[]; isError?: boolean } });
        })
        .catch((err: Error) => {
          bridgeLog().warn('bridge.tool_request.failed', {
            mcpId: originalId,
            clientId,
            toolName,
            ...redactError(err),
          });
          replyWithMetrics({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: `Tool execution failed: ${err.message}` }], isError: true },
          } as { result: { content: unknown[]; isError: boolean } });
        });
      return;
    }

    reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  } catch { /* malformed JSON */ }
}

// ── Zod → JSON Schema (minimal) ──────────────────────────────────────────
function zodToJsonSchema(z: unknown): Record<string, unknown> {
  const d = (z as any)?._def;
  if (!d) return {};
  const base: Record<string, unknown> = {};
  if (d.description) base.description = d.description;
  switch (d.typeName) {
    case 'ZodString': return { ...base, type: 'string' };
    case 'ZodNumber': return { ...base, type: 'number' };
    case 'ZodBoolean': return { ...base, type: 'boolean' };
    case 'ZodOptional': return zodToJsonSchema(d.innerType);
    case 'ZodDefault': return { ...zodToJsonSchema(d.innerType), default: d.defaultValue };
    case 'ZodEnum': return { ...base, type: 'string', enum: d.options };
    case 'ZodArray': return { ...base, type: 'array', items: zodToJsonSchema(d.innerType) };
    default: return base;
  }
}

// ── Log paths ─────────────────────────────────────────────────────────────
// The bridge writes its NDJSON log to <installDir>/logs/bridge.log. The
// extension forwards its own log lines over WS; the bridge writes those
// to <installDir>/logs/extension.log via the same logger module.
//
// Migration: prior versions wrote to <installDir>/bridge.log (single
// file, no rotation, freeform lines). On startup, if that file exists,
// we rename it to logs/bridge.log.legacy so historical crash records
// stay available without being mixed into the new NDJSON file.

function getInstallDir(): string {
  switch (osPlatform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'agenthub');
    default:
      return join(homedir(), '.local', 'share', 'agenthub');
  }
}

function getBridgeLogPath(): string {
  return join(getInstallDir(), 'logs', 'bridge.log');
}

function getExtensionLogPath(): string {
  return join(getInstallDir(), 'logs', 'extension.log');
}

function getLegacyBridgeLogPath(): string {
  return join(getInstallDir(), 'bridge.log');
}

/**
 * One-time startup migration: move the pre-0.5.6 single-file
 * bridge.log into the new logs/ subdirectory. Never deletes the
 * source — rename preserves data atomically if the destination dir
 * is writable. Failures are silent (logger must not block startup).
 */
function migrateLegacyBridgeLog(): void {
  const legacy = getLegacyBridgeLogPath();
  const target = join(getInstallDir(), 'logs', 'bridge.log.legacy');
  try {
    if (!existsSync(legacy)) return;
    if (existsSync(target)) return; // already migrated
    const dir = join(getInstallDir(), 'logs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    renameSync(legacy, target);
  } catch {
    // Permissions / cross-device move — give up. Old file stays in place.
  }
}

// Lazily-initialized bridge logger. Created on first call to bridgeLog()
// so tests can override the install dir via env (LOCALAPPDATA).
let _bridgeLogger: Logger | null = null;
function bridgeLog(): Logger {
  if (!_bridgeLogger) {
    _bridgeLogger = makeLogger({ filePath: getBridgeLogPath() }, 'bridge', process.pid);
  }
  return _bridgeLogger;
}

// Note: extension log entries are written directly via logRecord() in
// handleExtension's log_batch handler — they arrive pre-formatted from the
// extension (carrying their own src='ext'/pid). A cached logger would
// override those defaults, so we don't keep one here.

// ── Start server ──────────────────────────────────────────────────────────
export function startServer(port: number): void {
  serverPort = port;
  // Migrate the old single-file bridge.log into the new logs/ directory.
  // Cheap one-time check; no-op on subsequent startups.
  migrateLegacyBridgeLog();

  // Resolve the configured extension-id allowlist once at startup. The set
  // can stay empty — in that case verifyClient falls back to accepting any
  // chrome-extension:// origin (back-compat with installs predating the
  // CWS publish of AgentHub). When populated, only the listed extension IDs
  // are accepted: a co-installed malicious extension can no longer drive
  // the bridge via chrome.debugger blast radius.
  const allowedExtensionIds = loadAllowedExtensionIds();
  bridgeLog().info('bridge.lifecycle.start', {
    port,
    version: VERSION,
    buildId: BUILD_ID,
    startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? 'service',
    allowedExtensionIdsCount: allowedExtensionIds.size,
    // Log only the first 8 chars of each allowlisted ID. Enough for an LLM
    // debugging an origin rejection ("which IDs ARE allowed?") without
    // leaking the full ID to anyone reading the log. Real Chrome extension
    // IDs are 32 chars; first 8 chars uniquely identify the install on a
    // typical user's machine.
    allowedExtensionIdsSample: Array.from(allowedExtensionIds).map((id) => id.slice(0, 8) + '…'),
    // logFilePath stripped to the relative tail so user paths don't leak.
    logFilePath: getBridgeLogPath().replace(/^.*[\\/]agenthub[\\/]/i, '%LOCALAPPDATA%/agenthub/'),
  });
  // Origin check via verifyClient runs DURING the HTTP upgrade, before the
  // WS handshake completes. This means a disallowed origin sees an HTTP 401,
  // never gets an `open` event, and cannot send any data. The alternative
  // (ws.close() inside the connection handler) leaves a sliver of time
  // during which the WS is open from the client's perspective.
  // Sliding-window dedupe state for repeated origin events. Maps
  // `<event>:<origin>` → epoch ms of last log. Re-emits at most once
  // per minute per (event, origin) pair, with a `repeatedCount` summary.
  // Prevents the bridge.log from drowning in 149 identical rejection lines
  // every time an extension retries every 5 seconds (Tier 2 #6).
  const ORIGIN_LOG_DEDUPE_WINDOW_MS = 60_000;
  const originLogState = new Map<string, { lastLoggedAt: number; suppressed: number }>();
  function emitOriginEvent(eventName: 'bridge.ws.upgrade_accepted' | 'bridge.ws.upgrade_rejected', lvl: 'info' | 'warn', payload: Record<string, unknown>): void {
    const key = `${eventName}:${payload.origin}`;
    const now = Date.now();
    const state = originLogState.get(key);
    if (state && (now - state.lastLoggedAt) < ORIGIN_LOG_DEDUPE_WINDOW_MS) {
      state.suppressed++;
      return;
    }
    // Emit and reset the window
    const extras: Record<string, unknown> = { ...payload };
    if (state && state.suppressed > 0) {
      extras.suppressedSinceLastLog = state.suppressed;
    }
    originLogState.set(key, { lastLoggedAt: now, suppressed: 0 });
    if (lvl === 'info') bridgeLog().info(eventName, extras);
    else bridgeLog().warn(eventName, extras);
  }

  // ── HTTP + WS share a single port ────────────────────────────────────
  // The bridge listens on 127.0.0.1:7483 for BOTH:
  //   - HTTP requests (diagnostics UI: GET /, /api/*, POST /api/restart, ...)
  //   - WebSocket upgrades (MCP clients + browser extensions)
  // We create the http.Server explicitly so we can attach a request
  // handler, and pass it to WebSocketServer via `server` — ws then handles
  // upgrade events on its own.
  const httpServer = createHttpServer((req, res) => {
    handleDiagRequest(req, res, {
      onRestartRequest: () => {
        // Cleanest restart: cleanup handlers + exit. autostart respawns.
        // The lock-file cleanup handler runs on process.exit so the next
        // bridge gets a clean slate.
        bridgeLog().info('bridge.lifecycle.restart_requested', { initiator: 'diag-ui' });
        // eslint-disable-next-line n/no-process-exit
        process.exit(0);
      },
      onReloadExtensionRequest: (browserId?: string) => {
        let count = 0;
        let matchedBrowserId: string | undefined;
        if (browserId) {
          // Targeted reload — send only to the matching socket. Avoids
          // reloading every browser when only one is misbehaving.
          const ws = browserSockets.get(browserId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'reload', source: 'diag-ui' }));
              count = 1;
              matchedBrowserId = browserId;
            } catch { /* ignore */ }
          }
          bridgeLog().info('bridge.diag.reload_extension_targeted', {
            browserId, delivered: count > 0,
          });
        } else {
          // Broadcast — every connected extension reloads. Used by the
          // top-level "Reload all" button.
          for (const [, ws] of browserSockets) {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'reload', source: 'diag-ui' }));
                count++;
              } catch { /* ignore individual send failure */ }
            }
          }
          bridgeLog().info('bridge.diag.reload_extension_broadcast', { count });
        }
        return { broadcastTo: count, ...(matchedBrowserId ? { matchedBrowserId } : {}) };
      },
      getState: (): StateSource => {
        // Cross-reference: for each connected client / browser, count
        // how many of the recent N requests touched them. Cheap O(N*M)
        // where N≤50 (RecentActivity cap) and M = browsers+clients (≤10).
        const requests = recentActivity.snapshot().requests;
        const browserCounts = new Map<string, number>();
        const clientCounts = new Map<string, number>();
        for (const r of requests) {
          if (r.browserId) browserCounts.set(r.browserId, (browserCounts.get(r.browserId) ?? 0) + 1);
          if (r.clientId) clientCounts.set(r.clientId, (clientCounts.get(r.clientId) ?? 0) + 1);
        }
        return {
          bridge: {
            version: VERSION,
            buildId: BUILD_ID,
            pid: process.pid,
            port,
            uptimeSec: Math.floor((Date.now() - startTime) / 1000),
            startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? 'service',
            allowedExtensionIdsCount: allowedExtensionIds.size,
            allowedExtensionIdsSample: Array.from(allowedExtensionIds).map((id) => id.slice(0, 8) + '…'),
          },
          browsers: Array.from(browserRegistry.entries()).map(([browserId, info]) => {
            const lastSeenMs = browserLastSeen.get(browserId);
            const ageSec = lastSeenMs ? Math.floor((Date.now() - lastSeenMs) / 1000) : null;
            // Liveness derived from how recently we received any inbound
            // frame from this browser. Bridge sends server_ping every 20s,
            // so a healthy SW pongs within ~21s. If we haven't heard
            // anything in 45s, the SW is probably wedged even though the
            // OS-level WS still says OPEN.
            let liveness: 'live' | 'stale' | 'unknown' = 'unknown';
            if (ageSec !== null) {
              liveness = ageSec < 45 ? 'live' : 'stale';
            }
            return {
              browserId,
              connectedAt: info.connectedAt,
              recentRequestCount: browserCounts.get(browserId) ?? 0,
              lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
              lastSeenAgeSec: ageSec,
              liveness,
            };
          }),
          mcpClients: Array.from(mcpClientRegistry.entries()).map(([clientId, info]) => ({
            clientId,
            transport: info.transport,
            connectedAt: info.connectedAt,
            ...(info.clientInfo ? { clientInfo: info.clientInfo } : {}),
            recentRequestCount: clientCounts.get(clientId) ?? 0,
          })),
          recentActivity,
        };
      },
      logPaths: () => ({
        bridge: getBridgeLogPath(),
        extension: getExtensionLogPath(),
        helper: join(getInstallDir(), 'logs', 'helper.log'),
      }),
    });
  });

  const wss = new WebSocketServer({
    server: httpServer,
    // Cap incoming frame size at 4 MiB. Real tool requests max out around
    // 200 KB (page snapshots); 4 MiB headroom is generous. Beyond this,
    // ws closes the connection — protects bridge memory from a runaway
    // log_batch or malicious page-scraping tool result.
    maxPayload: 4 * 1024 * 1024,
    verifyClient: (info, done) => {
      const origin = info.origin ?? '(none)';
      if (isAllowedOrigin(info.origin, allowedExtensionIds)) {
        emitOriginEvent('bridge.ws.upgrade_accepted', 'info', { origin });
        done(true);
      } else {
        emitOriginEvent('bridge.ws.upgrade_rejected', 'warn', {
          origin,
          reason: 'origin_not_in_allowlist',
        });
        recentActivity.noteRejection(origin, 'origin_not_in_allowlist');
        done(false, 401, 'forbidden origin');
      }
    },
  });

  httpServer.listen(port, '127.0.0.1');

  // Write lock file with current PID/port so the installer can find and
  // terminate this process before reinstalling. Cleaned up on exit.
  try {
    writeLockFile({
      pid: process.pid,
      port,
      token: '',
      ipcPath: '',
      startedAt: new Date().toISOString(),
      version: VERSION,
      startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? 'service',
    });
    registerCleanupHandlers();
  } catch (err) {
    bridgeLog().error('bridge.lifecycle.lock_file_write_failed', { ...redactError(err) });
  }

  // Crash visibility: when launched detached or via autostart there is no
  // attached console, so any uncaught exception exits silently. Logging to a
  // file under the install dir gives users (and us) something to inspect.
  // The cleanup handlers registered above still run on process.exit and tear
  // down the lock file.
  process.on('uncaughtException', (err) => {
    bridgeLog().error('bridge.lifecycle.uncaught', { ...redactError(err) });
    // Re-throw so the default handler still tears the process down — autostart
    // / detached-spawn callers should restart it on the next event.
    setTimeout(() => { throw err; }, 0);
  });
  process.on('unhandledRejection', (reason) => {
    bridgeLog().error('bridge.lifecycle.unhandled_rejection', { ...redactError(reason) });
  });

  wss.on('connection', (ws, req) => {
    const params = parseQuery(req.url);
    if (params.get('role') === 'mcp') {
      handleMcpClient(ws);
    } else {
      handleExtension(ws, params.get('browserId') || 'default');
    }
  });

  // ── Global liveness sweep ────────────────────────────────────────────
  // Every BROWSER_LIVENESS_INTERVAL_MS, walk every connected browser and
  // run a fast liveness probe. Browsers that don't pong within
  // LIVENESS_PROBE_TIMEOUT_MS get their WS forcibly closed — which forces
  // the extension's reconnect logic to spin up a fresh SW life.
  //
  // Why we need this: MV3 service workers get suspended by Chrome aggressively.
  // The OS-level WS lingers in CLOSE_WAIT state — looks "OPEN" to the bridge
  // but no JS is actually receiving. Without active probing, the bridge holds
  // a dead reference and routes tool calls into the void.
  //
  // Cost: one tiny ping frame per browser per cycle. With ≤ 5 browsers and
  // a 15s cycle, that's ≤ 20 frames/minute. Negligible.
  const BROWSER_LIVENESS_INTERVAL_MS = 15_000;
  const livenessTimer = setInterval(async () => {
    const browsers = Array.from(browserSockets.entries())
      .filter(([id]) => id !== HELPER_PROBE_BROWSER_ID);
    for (const [browserId, ws] of browsers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const alive = await proveLive(browserId, ws, LIVENESS_PROBE_TIMEOUT_MS);
      if (!alive) {
        bridgeLog().warn('bridge.browser.liveness_failed', {
          browserId,
          reason: 'no_pong_to_periodic_probe',
          action: 'closing_socket_to_force_reconnect',
        });
        try { ws.close(1011, 'liveness_probe_failed'); } catch { /* ignore */ }
      }
    }
  }, BROWSER_LIVENESS_INTERVAL_MS);
  // Cleanup on bridge shutdown — though typically the bridge dies first.
  process.on('exit', () => clearInterval(livenessTimer));

  // Primary MCP client: read JSON-RPC from own stdio.
  // The MCP spec uses newline-delimited JSON ("\n" separator). Some legacy
  // tooling and our own e2e tests use LSP-style Content-Length framing.
  // The parser auto-detects on the first valid message and latches the
  // format for the rest of the session; replies use the same format.
  // When stdin closes (client exits), server keeps running for other clients + extensions.
  // Note: index.ts paused stdin during the port probe to avoid losing data;
  // explicitly resume after the data listener is wired up.
  const stdioFormat: { format: 'ndjson' | 'lsp' } = { format: 'ndjson' };
  parseStdioMessages(process.stdin, (json) => {
    handleMcpMessage('stdio', json, (msg) => {
      const body = JSON.stringify(msg);
      if (stdioFormat.format === 'lsp') {
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      } else {
        process.stdout.write(`${body}\n`);
      }
    });
  }, stdioFormat);
  if (typeof (process.stdin as NodeJS.ReadStream).resume === 'function') {
    (process.stdin as NodeJS.ReadStream).resume();
  }

  // Also note the stdio MCP client is implicitly connected.
  bridgeLog().info('bridge.mcp.client_connected', { clientId: 'stdio', transport: 'stdio' });
  mcpClientRegistry.set('stdio', { transport: 'stdio', connectedAt: new Date().toISOString() });
}

/** Stop the WS server and clean up the lock file. Used by tests. */
export function shutdownServer(): void {
  deleteLockFile();
}

// ── Stdio JSON-RPC parser (auto-detect NDJSON / Content-Length) ───────────
// MCP spec: newline-delimited JSON  →  JSON.stringify(msg) + "\n"
// LSP-style legacy framing:           →  Content-Length: N\r\n\r\n{body}
//
// We support both. The first valid parse latches the format via the optional
// `formatHolder` so the caller can mirror it on replies.
export function parseStdioMessages(
  stream: NodeJS.ReadableStream,
  onMessage: (json: string) => void,
  formatHolder?: { format: 'ndjson' | 'lsp' },
): void {
  let buffer = Buffer.alloc(0);
  let contentLength = -1;
  let latched = false;

  const latch = (f: 'ndjson' | 'lsp'): void => {
    if (formatHolder && !latched) {
      formatHolder.format = f;
      latched = true;
    }
  };

  stream.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);

    while (true) {
      // Drain in-progress Content-Length-framed body before re-detecting format.
      if (contentLength !== -1) {
        if (buffer.length < contentLength) break;
        const json = buffer.subarray(0, contentLength).toString();
        buffer = buffer.subarray(contentLength);
        contentLength = -1;
        latch('lsp');
        onMessage(json);
        continue;
      }

      // Skip leading whitespace / line breaks between messages.
      let i = 0;
      while (
        i < buffer.length &&
        (buffer[i] === 0x0a || buffer[i] === 0x0d || buffer[i] === 0x20 || buffer[i] === 0x09)
      ) i++;
      if (i > 0) buffer = buffer.subarray(i);
      if (buffer.length === 0) break;

      // NDJSON: top-level JSON value starts with '{' or '[', terminated by '\n'.
      if (buffer[0] === 0x7b /* { */ || buffer[0] === 0x5b /* [ */) {
        const nl = buffer.indexOf(0x0a);
        if (nl === -1) break; // need more data
        const line = buffer.subarray(0, nl).toString().replace(/\r$/, '');
        buffer = buffer.subarray(nl + 1);
        if (line) {
          latch('ndjson');
          onMessage(line);
        }
        continue;
      }

      // LSP framing: read header up to \r\n\r\n, then Content-Length bytes of body.
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break; // need full header
      const header = buffer.subarray(0, headerEnd).toString();
      const m = header.match(/Content-Length:\s*(\d+)/i);
      buffer = buffer.subarray(headerEnd + 4);
      if (m) {
        contentLength = parseInt(m[1], 10);
      }
      // Otherwise the unrecognized header is silently skipped; loop continues.
    }
  });
}
