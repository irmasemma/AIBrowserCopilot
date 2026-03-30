import { WebSocketServer, WebSocket } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

const DEFAULT_PORT = 7483; // Fixed port so extension always knows where to connect
const PORT_FILE_DIR = join(tmpdir(), 'ai-browser-copilot');
const PORT_FILE = join(PORT_FILE_DIR, 'relay-port');
const REQUEST_TIMEOUT = 30_000;

let wss: WebSocketServer | null = null;
let extensionSocket: WebSocket | null = null;
const pendingRequests = new Map<string, PendingCallback>();

export const startRelay = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    wss = new WebSocketServer({ host: '127.0.0.1', port: DEFAULT_PORT });

    wss.on('listening', () => {
      const addr = wss!.address();
      if (typeof addr === 'object' && addr !== null) {
        const port = addr.port;
        mkdirSync(PORT_FILE_DIR, { recursive: true });
        writeFileSync(PORT_FILE, String(port), 'utf-8');
        resolve(port);
      }
    });

    wss.on('connection', (ws) => {
      extensionSocket = ws;

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString()) as RelayResponse;
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
    });

    wss.on('error', reject);
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
    extensionSocket.send(JSON.stringify(request));
  });
};

export const isExtensionConnected = (): boolean =>
  extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN;
