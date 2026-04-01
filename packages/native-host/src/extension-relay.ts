import { WebSocketServer, WebSocket } from 'ws';
import net from 'node:net';
import { toolRegistry } from './tools/index.js';

// Inline version to avoid circular import with index.ts
const VERSION = '0.1.0';
import {
  checkExistingInstance,
  writeLockFile,
  deleteLockFile,
  getLockFilePath,
  registerCleanupHandlers,
  readLockFile,
  killProcess,
  waitForProcessExit,
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
    extensionSocket = null;
    // Reject all pending requests
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

export const startRelay = async (): Promise<number> => {
  const lockPath = getLockFilePath();

  // Check for existing instance — takeover if one is running
  const status = await checkExistingInstance(lockPath);
  if (status === 'alive') {
    const lock = readLockFile(lockPath);
    if (lock) {
      process.stderr.write(`Taking over from existing instance (PID ${lock.pid})\n`);
      killProcess(lock.pid);
      await waitForProcessExit(lock.pid);
    }
    deleteLockFile(lockPath);
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
      }, lockPath);

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
