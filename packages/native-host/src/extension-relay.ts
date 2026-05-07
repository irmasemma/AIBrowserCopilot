import { WebSocketServer, WebSocket } from 'ws';
import net from 'node:net';
import { toolRegistry } from './tools/index.js';

// Inline version to avoid circular import with index.ts
const VERSION = '0.2.0';
import {
  checkExistingInstance,
  writeLockFile,
  getLockFilePath,
  registerCleanupHandlers,
  deleteLockFile,
  writeWakeFile,
  deleteWakeFile,
} from './lock-file-manager.js';

export interface RelayRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface RelayResponse {
  id: string;
  result?: unknown;
  error?: { message: string; code: string };
}

type PendingCallback = {
  resolve: (response: RelayResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_PORT = 7483;
const REQUEST_TIMEOUT = 30_000;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
const pendingRequests = new Map<string, PendingCallback>();

let serverPort: number = 0;
let startedBy: string = 'unknown';
const startTime = Date.now();

export function setStartedBy(tool: string): void {
  startedBy = tool;
}

function getServerInfo() {
  return {
    type: 'server_info' as const,
    pid: process.pid,
    port: serverPort,
    version: VERSION,
    startedBy,
    capabilities: toolRegistry.map((t) => t.name),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
}

const handleConnection = (ws: WebSocket, _req: { url?: string }): void => {
  // No token auth needed — server binds to 127.0.0.1 only (localhost)

  extensionSocket = ws;
  process.stderr.write(`[relay] extension WS connected\n`);

  // AD-18: Extension arrived — delete wake signal
  deleteWakeFile();

  // Send server info on connect
  ws.send(JSON.stringify(getServerInfo()));

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());

      // Handle ping → pong heartbeat
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: parsed.timestamp }));
        return;
      }

      // Handle tool scan request
      if (parsed.type === 'request_tool_scan') {
        // Will be implemented in C3.1 — for now send empty
        ws.send(JSON.stringify({ type: 'tool_scan', tools: [] }));
        return;
      }

      // Handle tool response
      const response = parsed as RelayResponse;
      const pending = pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    process.stderr.write(`[relay] extension WS closed\n`);
    // Only null out the global if THIS ws is still the active one. If the
    // extension already reconnected, extensionSocket points at the newer ws —
    // mustn't clobber it.
    if (extensionSocket !== ws) {
      return;
    }
    extensionSocket = null;
    // Reject all pending requests bound to this socket
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension disconnected'));
      pendingRequests.delete(id);
    }
  });
};

async function findAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(preferred, '127.0.0.1', () => {
      server.close(() => resolve(preferred));
    });
    server.on('error', () => {
      // Preferred port taken — use OS-assigned
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const addr = fallback.address();
        const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        fallback.close(() => resolve(port));
      });
    });
  });
}

export interface StartRelayOptions {
  ipcPath?: string;
}

export const startRelay = async (opts: StartRelayOptions = {}): Promise<number> => {
  const lockPath = getLockFilePath();

  // Singleton invariant: if another service is already alive, refuse to start.
  // (Pre-Phase-1 behavior was to kill the prior PID — replaced with attach via stub.)
  const status = await checkExistingInstance(lockPath);
  if (status === 'alive') {
    throw new Error('Another ai-browser-copilot service is already running. Connect via stub instead.');
  }
  if (status === 'orphaned') {
    deleteLockFile(lockPath);
  }

  // Find available port
  const port = await findAvailablePort(DEFAULT_PORT);
  serverPort = port;

  return new Promise((resolve, reject) => {
    wss = new WebSocketServer({ host: '127.0.0.1', port });

    wss.on('listening', () => {
      // Write lock file (no token — localhost-only server)
      writeLockFile({
        pid: process.pid,
        port,
        token: '',
        startedAt: new Date().toISOString(),
        version: VERSION,
        startedBy,
        ipcPath: opts.ipcPath,
      }, lockPath);

      // AD-18: Write wake file to signal extension that server is ready
      writeWakeFile(port);

      // Register cleanup handlers
      registerCleanupHandlers(lockPath);

      resolve(port);
    });

    wss.on('error', (err) => {
      reject(err);
    });

    wss.on('connection', (ws, req) => {
      handleConnection(ws, req);
    });
  });
};

export const sendToExtension = (request: RelayRequest): Promise<RelayResponse> => {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
      reject(new Error('Extension not connected'));
      return;
    }

    const timer = setTimeout(() => {
      pendingRequests.delete(request.id);
      reject(new Error('Tool request timed out'));
    }, REQUEST_TIMEOUT);

    pendingRequests.set(request.id, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ type: 'tool_request', ...request }));
  });
};

export const isExtensionConnected = (): boolean =>
  extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;

// AD-17: Wait for extension to connect, with bounded timeout
const EXTENSION_RECONNECT_TIMEOUT_MS = 35_000;
const POLL_INTERVAL_MS = 500;

export function waitForExtensionConnection(timeoutMs: number = EXTENSION_RECONNECT_TIMEOUT_MS): Promise<boolean> {
  if (isExtensionConnected()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (isExtensionConnected()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(true);
      }
    }, POLL_INTERVAL_MS);

    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, timeoutMs);
  });
}

export const stopRelay = (): Promise<void> => {
  return new Promise((resolve) => {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Relay stopped'));
      pendingRequests.delete(id);
    }
    if (extensionSocket) {
      extensionSocket.close();
      extensionSocket = null;
    }
    if (wss) {
      wss.close(() => resolve());
      wss = null;
    } else {
      resolve();
    }
    serverPort = 0;
  });
};
