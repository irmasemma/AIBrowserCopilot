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
  /**
   * Close the socket WITHOUT nulling `onclose` first. Relied on by callers
   * that need the real close event to drive recovery: the server_info
   * timeout and heartbeat `onDead()` in connection-manager. Do NOT change
   * this to null handlers — see `discard()` for the genuine-replace path.
   */
  disconnect(): void;
  /**
   * Close the socket AS a genuine replace/teardown: nulls onopen/onclose/
   * onerror/onmessage BEFORE closing, so this socket's close event — which
   * fires asynchronously and can land after a newer connect() has already
   * started — can never reach `callbacks`. Route ONLY through the two
   * genuine replace sites (openRelay()'s pre-replace, stopAll()). See
   * docs/rca-2026-07-06-same-life-reconnect-storm.md §4 item 1.
   */
  discard(): void;
  send(message: unknown): void;
  sendPing(timestamp: number): void;
  sendToolResponse(id: string, result: unknown): void;
  sendToolError(id: string, error: { message: string; code: string }): void;
  isConnected(): boolean;
  /** True only while the socket is mid-handshake (readyState CONNECTING). */
  isConnecting(): boolean;
}

// CONNECTING-phase bound: nothing else bounds a socket stuck CONNECTING
// forever (e.g. a SYN black-holed by a firewall/misrouted network) —
// `serverInfoTimer` in connection-manager only starts AFTER `onopen`. Force-
// fail and synthesize a close so the normal reconnect/backoff path still
// runs promptly instead of hanging indefinitely.
const CONNECTING_TIMEOUT_MS = 12_000;
export const CONNECTING_TIMEOUT_CLOSE_CODE = 4098;
export const CONNECTING_TIMEOUT_CLOSE_REASON = 'connecting_timeout';

export function createRelay(callbacks: RelayCallbacks): Relay {
  let ws: WebSocket | null = null;
  let connectingTimer: ReturnType<typeof setTimeout> | null = null;

  function clearConnectingTimer(): void {
    if (connectingTimer !== null) {
      clearTimeout(connectingTimer);
      connectingTimer = null;
    }
  }

  function nullHandlers(socket: WebSocket): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

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
    clearConnectingTimer();
    if (ws) {
      nullHandlers(ws);
      ws = null;
    }
  }

  return {
    connect(url: string): void {
      // Close any pre-existing connection first via the same safe-replace
      // logic as discard(): null handlers BEFORE closing so a stale close
      // event can never reach `callbacks`. In practice each relay instance
      // is connect()'d exactly once (connection-manager always creates a
      // fresh instance per attempt) — this stays as defense-in-depth for any
      // future caller that reuses one instance across attempts.
      if (ws) {
        const old = ws;
        ws = null;
        nullHandlers(old);
        old.close();
      }
      cleanup(); // clears any leftover connectingTimer from the old socket

      const socket = new WebSocket(url);
      ws = socket;

      connectingTimer = setTimeout(() => {
        connectingTimer = null;
        // Only acts if THIS socket is still the live one and still stuck
        // CONNECTING. Null handlers before forcing close so a native close
        // event — if the browser ever gets around to firing one — cannot
        // double-dispatch on top of the synthesized failure below.
        if (ws === socket && socket.readyState === WebSocket.CONNECTING) {
          nullHandlers(socket);
          ws = null;
          try { socket.close(); } catch { /* ignore */ }
          callbacks.onClose(CONNECTING_TIMEOUT_CLOSE_CODE, CONNECTING_TIMEOUT_CLOSE_REASON);
        }
      }, CONNECTING_TIMEOUT_MS);

      socket.onopen = () => {
        clearConnectingTimer();
        callbacks.onOpen();
      };

      socket.onclose = (event: CloseEvent) => {
        clearConnectingTimer();
        callbacks.onClose(event.code, event.reason);
        cleanup();
      };

      socket.onerror = (event: Event) => {
        callbacks.onError(event);
      };

      socket.onmessage = routeMessage;
    },

    disconnect(): void {
      // UNCHANGED semantics: leaves onclose wired. Callers (server_info
      // timeout, heartbeat onDead) rely on the real close event to dispatch
      // WS_CLOSE and drive scheduleBackoff(). Do not null handlers here.
      if (ws) {
        ws.close();
        // onclose handler will call cleanup (and clear the connecting timer)
      }
    },

    discard(): void {
      // Genuine replace/teardown path (openRelay()'s pre-replace, stopAll()).
      // Null ALL handlers before closing so this socket's close event —
      // fired asynchronously by the browser, sometimes AFTER a new socket
      // has already started connecting — can never reach `callbacks`.
      clearConnectingTimer();
      if (ws) {
        const socket = ws;
        ws = null;
        nullHandlers(socket);
        try { socket.close(); } catch { /* ignore */ }
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

    isConnecting(): boolean {
      return ws !== null && ws.readyState === WebSocket.CONNECTING;
    },
  };
}
