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
            buildId: data.buildId,
            startedBy: data.startedBy,
            capabilities: data.capabilities,
            uptime: data.uptime,
            connectedBrowsers: data.connectedBrowsers,
            connectedStubs: data.connectedStubs,
          });
          break;
        case 'pong':
          callbacks.onPong(data.timestamp);
          break;
        case 'server_ping':
          // Bridge-initiated keepalive. The fact that this onmessage handler
          // ran means the SW just woke up — that alone is the goal. Reply
          // with server_pong so the bridge can monitor liveness if it wants.
          safeSend({ type: 'server_pong', timestamp: data.timestamp });
          break;
        case 'tool_request':
          callbacks.onToolRequest(data.id, data.tool, data.params ?? {});
          break;
        case 'tool_scan':
          callbacks.onToolScan(data.tools ?? []);
          break;
        case 'reload':
          // Bridge-initiated reload (from the diagnostics UI). Triggers a
          // full extension reload — kills the SW, restarts it, reopens
          // the WS. Short delay so the user can see the toast and so this
          // handler returns cleanly first.
          try {
            setTimeout(() => {
              try {
                chrome.runtime.reload();
              } catch { /* dev contexts without chrome.runtime */ }
            }, 250);
          } catch { /* ignore */ }
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
