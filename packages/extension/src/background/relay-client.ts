import type { ServerInfo, ToolScanResult } from '../shared/types';

export interface RelayCallbacks {
  onOpen: () => void;
  onClose: (code: number, reason: string) => void;
  onError: (error: Event) => void;
  onServerInfo: (info: ServerInfo) => void;
  onPong: (timestamp: number) => void;
  onToolRequest: (id: string, tool: string, params: Record<string, unknown>) => void;
  onToolScan: (tools: ToolScanResult[]) => void;
}

export interface Relay {
  connect(url: string): void;
  disconnect(): void;
  send(message: unknown): void;
  sendPing(timestamp: number): void;
  sendToolResponse(id: string, result: unknown): void;
  sendToolError(id: string, error: { message: string; code: string }): void;
  isConnected(): boolean;
}

export function createRelay(callbacks: RelayCallbacks): Relay {
  let ws: WebSocket | null = null;

  function safeSend(data: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(data));
  }

  function routeMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string);
      switch (data.type) {
        case 'server_info':
          callbacks.onServerInfo({
            pid: data.pid,
            port: data.port,
            version: data.version,
            startedBy: data.startedBy,
            capabilities: data.capabilities,
            uptime: data.uptime,
          });
          break;
        case 'pong':
          callbacks.onPong(data.timestamp);
          break;
        case 'tool_request':
          callbacks.onToolRequest(data.id, data.tool, data.params ?? {});
          break;
        case 'tool_scan':
          callbacks.onToolScan(data.tools ?? []);
          break;
        default:
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  }

  function cleanup(): void {
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws = null;
    }
  }

  return {
    connect(url: string): void {
      // Close any existing connection first
      if (ws) {
        ws.onclose = null; // Prevent callback from old socket
        ws.close();
        cleanup();
      }

      ws = new WebSocket(url);

      ws.onopen = () => {
        callbacks.onOpen();
      };

      ws.onclose = (event: CloseEvent) => {
        callbacks.onClose(event.code, event.reason);
        cleanup();
      };

      ws.onerror = (event: Event) => {
        callbacks.onError(event);
      };

      ws.onmessage = routeMessage;
    },

    disconnect(): void {
      if (ws) {
        ws.close();
        // onclose handler will call cleanup
      }
    },

    send(message: unknown): void {
      safeSend(message);
    },

    sendPing(timestamp: number): void {
      safeSend({ type: 'ping', timestamp });
    },

    sendToolResponse(id: string, result: unknown): void {
      safeSend({ type: 'tool_response', id, result });
    },

    sendToolError(id: string, error: { message: string; code: string }): void {
      safeSend({ type: 'tool_error', id, error });
    },

    isConnected(): boolean {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },
  };
}
