// Native Host ↔ Extension message protocol

export type ExtensionMessage =
  | { type: 'tool_request'; id: string; tool: string; params: Record<string, unknown> }
  | { type: 'ping' }
  | { type: 'request_tool_scan' };

export type NativeHostMessage =
  | { type: 'tool_response'; id: string; result: unknown }
  | { type: 'tool_error'; id: string; error: { message: string; code: string } }
  | { type: 'mcp_status'; connected: boolean; host: string }
  | { type: 'pong' }
  | { type: 'server_info'; pid: number; port: number; version: string; startedBy: string; capabilities: string[]; uptime: number }
  | { type: 'tool_scan'; tools: ToolScanResult[] };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'reconnecting';

/** @deprecated Use ConnectionContext instead. Kept for backward compatibility. */
export interface ConnectionInfo {
  state: ConnectionState;
  lastConnected: number | null;
  error: string | null;
  relayPort?: number;
  lastToolCall?: number | null;
  serverPid?: number | null;
}

export interface ServerInfo {
  pid: number;
  port: number;
  version: string;
  startedBy: string;
  capabilities: string[];
  uptime: number;
}

export interface ConnectionContext {
  state: ConnectionState;
  failureCount: number;
  missedHeartbeats: number;
  lastConnectedAt: number | null;
  serverInfo: ServerInfo | null;
  error: string | null;
  reconnectsThisSession: number;
}

export interface ToolScanResult {
  tool: string;
  slug: string;
  installed: boolean;
  configured: boolean;
  configPath: string;
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
