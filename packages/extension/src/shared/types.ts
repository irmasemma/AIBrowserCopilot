// Native Host ↔ Extension message protocol

export type ExtensionMessage =
  | { type: 'tool_request'; id: string; tool: string; params: Record<string, unknown> }
  | { type: 'ping' };

export type NativeHostMessage =
  | { type: 'tool_response'; id: string; result: unknown }
  | { type: 'tool_error'; id: string; error: { message: string; code: string } }
  | { type: 'mcp_status'; connected: boolean; host: string }
  | { type: 'pong' };

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'setup-needed';

export interface ConnectionInfo {
  state: ConnectionState;
  lastConnected: number | null;
  error: string | null;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  tool: string;
  targetUrl: string | null;
  status: 'success' | 'error' | 'blocked' | 'in-progress';
  duration: number | null;
  errorCode: string | null;
}
