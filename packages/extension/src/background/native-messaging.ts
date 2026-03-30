import type { ExtensionMessage, NativeHostMessage, ConnectionInfo } from '../shared/types.js';
import { NATIVE_HOST_NAME, REQUEST_TIMEOUT_MS } from '../shared/constants.js';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const generateId = (): string => {
  return crypto.randomUUID();
};

let port: chrome.runtime.Port | null = null;
let connectAttempts = 0;
const MAX_CONNECT_ATTEMPTS = 3;
const pendingRequests = new Map<string, PendingRequest>();

const persistConnectionState = async (info: ConnectionInfo): Promise<void> => {
  await chrome.storage.local.set({ connectionState: info });
};

const handleMessage = (message: NativeHostMessage): void => {
  if (message.type === 'tool_response' || message.type === 'tool_error') {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingRequests.delete(message.id);

    if (message.type === 'tool_response') {
      pending.resolve(message.result);
    } else {
      pending.reject(message.error);
    }
  } else if (message.type === 'mcp_status') {
    persistConnectionState({
      state: message.connected ? 'connected' : 'disconnected',
      lastConnected: message.connected ? Date.now() : null,
      error: null,
    });
  } else if (message.type === 'pong') {
    // Health check response — no action needed
  }
};

const handleDisconnect = (): void => {
  port = null;

  // Reject all pending requests
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject({ message: 'Connection lost', code: 'CONTENT_UNAVAILABLE' });
    pendingRequests.delete(id);
  }

  connectAttempts++;

  if (connectAttempts >= MAX_CONNECT_ATTEMPTS) {
    persistConnectionState({
      state: 'setup-needed',
      lastConnected: null,
      error: 'Native host not found. Run: npx ai-browser-copilot-setup',
    });
    return;
  }

  persistConnectionState({
    state: 'reconnecting',
    lastConnected: null,
    error: 'Native host disconnected',
  });

  // Auto-reconnect after 1 second
  setTimeout(() => connect(), 1000);
};

export const resetAndConnect = (): void => {
  connectAttempts = 0;
  if (port) return;
  connect();
};

export const connect = (): void => {
  if (port) return;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);

    connectAttempts = 0; // Reset on successful connection

    persistConnectionState({
      state: 'connected',
      lastConnected: Date.now(),
      error: null,
    });
  } catch {
    persistConnectionState({
      state: 'setup-needed',
      lastConnected: null,
      error: 'Native host not found. Run setup assistant.',
    });
  }
};

export const sendToolRequest = (tool: string, params: Record<string, unknown>): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    if (!port) {
      reject({ message: 'Not connected to native host', code: 'CONTENT_UNAVAILABLE' });
      return;
    }

    const id = generateId();

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject({ message: 'Tool request timed out', code: 'RATE_LIMITED' });
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    const message: ExtensionMessage = { type: 'tool_request', id, tool, params };
    port.postMessage(message);
  });
};

export const isConnected = (): boolean => port !== null;
