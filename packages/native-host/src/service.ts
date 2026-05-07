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
import { toolRegistry } from './tools/index.js';
import { VERSION } from './version.js';
import {
  writeLockFile,
  deleteLockFile,
  registerCleanupHandlers,
} from './lock-file-manager.js';

const REQUEST_TIMEOUT_MS = 30_000;

// ── Browser extension connections ─────────────────────────────────────────
const browserSockets = new Map<string, WebSocket>();

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
    startedBy: 'service',
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
function handleExtension(ws: WebSocket, browserId: string): void {
  process.stderr.write(`Browser connected: ${browserId}\n`);
  browserSockets.set(browserId, ws);
  ws.send(JSON.stringify(getServerInfo()));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
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
    if (browserSockets.get(browserId) === ws) {
      browserSockets.delete(browserId);
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

// ── Send tool request to browser extension ────────────────────────────────
function sendToolRequest(
  clientId: string,
  originalId: string | number | null,
  tool: string,
  params: Record<string, unknown>,
  browserId: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = browserSockets.get(browserId)
      || browserSockets.get('default')
      || Array.from(browserSockets.values()).find((s) => s.readyState === WebSocket.OPEN);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('No browser extension connected'));
      return;
    }

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
          serverInfo: { name: 'ai-browser-copilot', version: VERSION },
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
      const browserId = (toolArgs.browser as string) || 'default';
      const originalId = (msg.id ?? null) as string | number | null;

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

// ── Start server ──────────────────────────────────────────────────────────
export function startServer(port: number): void {
  serverPort = port;
  const wss = new WebSocketServer({ host: '127.0.0.1', port });

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
      startedBy: 'service',
    });
    registerCleanupHandlers();
  } catch (err) {
    process.stderr.write(`Failed to write lock file: ${(err as Error).message}\n`);
  }

  wss.on('connection', (ws, req) => {
    const params = parseQuery(req.url);
    if (params.get('role') === 'mcp') {
      handleMcpClient(ws);
    } else {
      handleExtension(ws, params.get('browserId') || 'default');
    }
  });

  // Primary MCP client: read JSON-RPC from own stdio (Content-Length framed)
  // When stdin closes (client exits), server keeps running for other clients + extensions.
  // Note: index.ts paused stdin during the port probe to avoid losing data;
  // explicitly resume after the data listener is wired up.
  parseStdioMessages(process.stdin, (json) => {
    handleMcpMessage('stdio', json, (msg) => {
      const body = JSON.stringify(msg);
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  });
  if (typeof (process.stdin as NodeJS.ReadStream).resume === 'function') {
    (process.stdin as NodeJS.ReadStream).resume();
  }

  process.stderr.write(`Server started on 127.0.0.1:${port} (pid=${process.pid})\n`);
}

/** Stop the WS server and clean up the lock file. Used by tests. */
export function shutdownServer(): void {
  deleteLockFile();
}

// ── Content-Length framed stdio parser ─────────────────────────────────────
// MCP protocol uses HTTP-style framing: Content-Length: N\r\n\r\n{json}
export function parseStdioMessages(stream: NodeJS.ReadableStream, onMessage: (json: string) => void): void {
  let buffer = Buffer.alloc(0);
  let contentLength = -1;

  stream.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);

    while (true) {
      if (contentLength === -1) {
        // Look for \r\n\r\n header separator
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;

        const header = buffer.subarray(0, headerEnd).toString();
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Not Content-Length framed — try as raw JSON line (fallback)
          const line = buffer.subarray(0, headerEnd).toString().trim();
          buffer = buffer.subarray(headerEnd + 4);
          if (line) onMessage(line);
          continue;
        }
        contentLength = parseInt(match[1], 10);
        buffer = buffer.subarray(headerEnd + 4);
      }

      if (contentLength >= 0 && buffer.length >= contentLength) {
        const json = buffer.subarray(0, contentLength).toString();
        buffer = buffer.subarray(contentLength);
        contentLength = -1;
        onMessage(json);
      } else {
        break;
      }
    }
  });
}
