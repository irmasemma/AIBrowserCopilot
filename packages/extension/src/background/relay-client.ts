import type { ConnectionInfo } from '../shared/types.js';

interface ToolRequest {
  id: string;
  tool: string;
  params: Record<string, unknown>;
}

interface ToolResponse {
  id: string;
  result?: unknown;
  error?: { message: string; code: string };
}

type ToolHandler = (tool: string, params: Record<string, unknown>) => Promise<unknown>;

let socket: WebSocket | null = null;
let toolHandler: ToolHandler | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const persistConnectionState = async (info: ConnectionInfo): Promise<void> => {
  await chrome.storage.local.set({ connectionState: info });
};

const getRelayPort = async (): Promise<number | null> => {
  // Read port from well-known storage key (set during setup)
  const data = await chrome.storage.local.get('relayPort');
  return data.relayPort ?? null;
};

const handleMessage = (event: MessageEvent) => {
  try {
    const request = JSON.parse(event.data as string) as ToolRequest;
    if (!request.id || !request.tool || !toolHandler) return;

    toolHandler(request.tool, request.params)
      .then((result) => {
        const response: ToolResponse = { id: request.id, result };
        socket?.send(JSON.stringify(response));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const code = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
        const response: ToolResponse = { id: request.id, error: { message, code } };
        socket?.send(JSON.stringify(response));
      });
  } catch {
    // Ignore malformed messages
  }
};

export const connectToRelay = async (handler: ToolHandler): Promise<void> => {
  toolHandler = handler;
  const port = await getRelayPort();
  if (!port) {
    await persistConnectionState({
      state: 'setup-needed',
      lastConnected: null,
      error: 'Relay port not configured. Run setup assistant.',
    });
    return;
  }

  try {
    socket = new WebSocket(`ws://127.0.0.1:${port}`);

    socket.onopen = () => {
      persistConnectionState({
        state: 'connected',
        lastConnected: Date.now(),
        error: null,
      });
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    socket.onmessage = handleMessage;

    socket.onclose = () => {
      socket = null;
      persistConnectionState({
        state: 'reconnecting',
        lastConnected: null,
        error: 'Connection lost',
      });
      scheduleReconnect(handler);
    };

    socket.onerror = () => {
      socket?.close();
    };
  } catch {
    await persistConnectionState({
      state: 'disconnected',
      lastConnected: null,
      error: 'Failed to connect to relay',
    });
    scheduleReconnect(handler);
  }
};

const scheduleReconnect = (handler: ToolHandler): void => {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToRelay(handler);
  }, 2000);
};

export const isRelayConnected = (): boolean =>
  socket !== null && socket.readyState === WebSocket.OPEN;
