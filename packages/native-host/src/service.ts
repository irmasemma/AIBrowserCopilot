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
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { toolRegistry } from './tools/index.js';
import { VERSION, BUILD_ID } from './version.js';
import {
  writeLockFile,
  deleteLockFile,
  registerCleanupHandlers,
} from './lock-file-manager.js';

const REQUEST_TIMEOUT_MS = 30_000;

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
  const existing = browserSockets.get(browserId);
  if (existing && existing !== ws) {
    try { existing.terminate(); } catch { /* noop */ }
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

function handleExtension(ws: WebSocket, browserId: string): void {
  process.stderr.write(`Browser connected: ${browserId}\n`);
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
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
        return;
      }
      if (msg.type === 'server_pong') {
        // Extension replied to our keepalive ping. No bookkeeping needed —
        // arrival of any message is what keeps the SW awake on its end.
        return;
      }
      if (msg.type === 'request_tool_scan') {
        ws.send(JSON.stringify({ type: 'tool_scan', tools: [] }));
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
      process.stderr.write(`Browser disconnected: ${browserId}\n`);
    }
  });
}

// ── Handle secondary MCP client connection (over WS) ──────────────────────
function handleMcpClient(ws: WebSocket): void {
  const clientId = randomUUID();
  mcpClients.set(clientId, ws);
  process.stderr.write(`MCP client connected: ${clientId}\n`);

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
    process.stderr.write(`MCP client disconnected: ${clientId}\n`);
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
    throw new Error('No browser extension connected');
  }

  return new Promise((resolve, reject) => {

    // Server-generated id, unique across all MCP clients, used as the
    // routing key in pendingRequests and as the id sent to the extension.
    const browserBoundId = `b_${randomUUID()}`;

    const timer = setTimeout(() => {
      pendingRequests.delete(browserBoundId);
      reject(new Error('Tool request timed out'));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(browserBoundId, { clientId, originalId, resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'tool_request', id: browserBoundId, tool, params }));
  });
}

// Per-browser timeout for fan-out tools. Shorter than REQUEST_TIMEOUT_MS so
// one slow browser doesn't stall the aggregate response.
const FAN_OUT_TIMEOUT_MS = 2_000;

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
    targets.map(({ browserId, ws }) =>
      new Promise<FanOutResult | FanOutError>((resolve) => {
        const browserBoundId = `b_${randomUUID()}`;
        const timer = setTimeout(() => {
          pendingRequests.delete(browserBoundId);
          resolve({ browserId, ok: false, error: 'timeout' });
        }, FAN_OUT_TIMEOUT_MS);

        pendingRequests.set(browserBoundId, {
          clientId,
          originalId: null,
          resolve: (response) => resolve({ browserId, ok: true, response }),
          reject: (err) => resolve({ browserId, ok: false, error: err.message }),
          timer,
        });
        ws.send(JSON.stringify({ type: 'tool_request', id: browserBoundId, tool, params }));
      }),
    ),
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
      result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
      error?: { message?: string };
    };

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

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

// ── MCP JSON-RPC handler (shared by stdio + WS clients) ──────────────────
function handleMcpMessage(clientId: string, raw: string, reply: (msg: unknown) => void): void {
  try {
    const msg = JSON.parse(raw);

    if (msg.method === 'initialize') {
      reply({
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agenthub', version: VERSION },
        },
      });
      return;
    }

    if (msg.method === 'notifications/initialized') return;

    if (msg.method === 'tools/list') {
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

      // list_tabs is a fan-out tool: aggregate tabs across every connected
      // extension instance, regardless of profile, so users with multiple
      // Chrome profiles see one unified view. Optional `browser` param
      // narrows the broadcast to a single brand.
      if (toolName === 'list_tabs') {
        const brandFilter = browserId === 'default' ? null : browserId;
        fanOutToolRequest(clientId, toolName, toolArgs, brandFilter)
          .then((results) => {
            if (results.length === 0) {
              reply({
                jsonrpc: '2.0', id: msg.id,
                result: { content: [{ type: 'text', text: 'No browser extension connected' }], isError: true },
              });
              return;
            }
            reply({ jsonrpc: '2.0', id: msg.id, result: mergeFanOutListTabs(results) });
          })
          .catch((err: Error) => {
            reply({
              jsonrpc: '2.0', id: msg.id,
              result: { content: [{ type: 'text', text: `list_tabs fan-out failed: ${err.message}` }], isError: true },
            });
          });
        return;
      }

      sendToolRequest(clientId, originalId, toolName, toolArgs, browserId)
        .then((response: unknown) => {
          const resp = response as { result?: unknown };
          reply({ jsonrpc: '2.0', id: msg.id, result: resp.result ?? resp });
        })
        .catch((err: Error) => {
          reply({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: `Tool execution failed: ${err.message}` }], isError: true },
          });
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

// ── Crash-log location ────────────────────────────────────────────────────
function getBridgeLogPath(): string {
  switch (osPlatform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub', 'bridge.log');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'agenthub', 'bridge.log');
    default:
      return join(homedir(), '.local', 'share', 'agenthub', 'bridge.log');
  }
}

function appendBridgeLog(line: string): void {
  try {
    const path = getBridgeLogPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString();
    appendFileSync(path, `[${stamp}] [pid ${process.pid}] ${line}\n`, 'utf-8');
  } catch {
    // Don't let a logging failure stop the bridge.
  }
}

// ── Start server ──────────────────────────────────────────────────────────
export function startServer(port: number): void {
  serverPort = port;
  // Resolve the configured extension-id allowlist once at startup. The set
  // can stay empty — in that case verifyClient falls back to accepting any
  // chrome-extension:// origin (back-compat with installs predating the
  // CWS publish of AgentHub). When populated, only the listed extension IDs
  // are accepted: a co-installed malicious extension can no longer drive
  // the bridge via chrome.debugger blast radius.
  const allowedExtensionIds = loadAllowedExtensionIds();
  if (allowedExtensionIds.size > 0) {
    process.stderr.write(
      `Origin allowlist active: ${Array.from(allowedExtensionIds).join(', ')}\n`,
    );
  } else {
    process.stderr.write(
      'Origin allowlist not configured — accepting any chrome-extension:// origin. ' +
      'Set AGENTHUB_ALLOWED_EXTENSION_IDS or write <installDir>/extension-ids.json to pin.\n',
    );
  }
  // Origin check via verifyClient runs DURING the HTTP upgrade, before the
  // WS handshake completes. This means a disallowed origin sees an HTTP 401,
  // never gets an `open` event, and cannot send any data. The alternative
  // (ws.close() inside the connection handler) leaves a sliver of time
  // during which the WS is open from the client's perspective.
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    verifyClient: (info, done) => {
      if (isAllowedOrigin(info.origin, allowedExtensionIds)) {
        done(true);
      } else {
        process.stderr.write(`Rejected WS upgrade from disallowed origin: ${info.origin}\n`);
        done(false, 401, 'forbidden origin');
      }
    },
  });

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
    process.stderr.write(`Failed to write lock file: ${(err as Error).message}\n`);
  }

  // Crash visibility: when launched detached or via autostart there is no
  // attached console, so any uncaught exception exits silently. Logging to a
  // file under the install dir gives users (and us) something to inspect.
  // The cleanup handlers registered above still run on process.exit and tear
  // down the lock file.
  process.on('uncaughtException', (err) => {
    appendBridgeLog(`uncaughtException: ${err?.stack ?? err}`);
    // Re-throw so the default handler still tears the process down — autostart
    // / detached-spawn callers should restart it on the next event.
    setTimeout(() => { throw err; }, 0);
  });
  process.on('unhandledRejection', (reason) => {
    appendBridgeLog(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });

  appendBridgeLog(`Server started on 127.0.0.1:${port} v${VERSION} buildId=${BUILD_ID} startedBy=${process.env.AI_BROWSER_COPILOT_STARTED_BY ?? 'service'}`);

  wss.on('connection', (ws, req) => {
    const params = parseQuery(req.url);
    if (params.get('role') === 'mcp') {
      handleMcpClient(ws);
    } else {
      handleExtension(ws, params.get('browserId') || 'default');
    }
  });

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

  process.stderr.write(`Server started on 127.0.0.1:${port} (pid=${process.pid})\n`);
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
