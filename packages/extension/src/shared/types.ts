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
  | { type: 'server_info'; pid: number; port: number; version: string; buildId?: string; startedBy: string; capabilities: string[]; uptime: number; connectedBrowsers?: string[]; connectedStubs?: number }
  | { type: 'tool_scan'; tools: ToolScanResult[] };

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'reconnecting';

export type DiagnosticReason =
  | 'connecting'
  | 'no_lock_file'
  | 'bridge_not_started'
  | 'server_not_responding'
  | 'protocol_timeout'
  | 'helper_unavailable'
  | 'was_connected';

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
  buildId?: string;
  startedBy: string;
  capabilities: string[];
  uptime: number;
  connectedBrowsers?: string[];
  connectedStubs?: number;
}

export interface ConnectionContext {
  state: ConnectionState;
  failureCount: number;
  missedHeartbeats: number;
  lastConnectedAt: number | null;
  serverInfo: ServerInfo | null;
  error: string | null;
  reconnectsThisSession: number;
  diagnosticReason: DiagnosticReason | null;
  lastVerifiedAt: number;
  /**
   * 'outdated' when the connected native-host version is older than
   * MIN_NATIVE_HOST_VERSION; 'ok' when current; null when not yet evaluated
   * (e.g. no server_info has been received yet).
   */
  versionStatus: 'ok' | 'outdated' | null;
}

export type DisplayState = ConnectionState | 'stale';

/** Threshold in ms — if lastVerifiedAt is older than this, state is stale */
export const STALE_THRESHOLD_MS = 40_000;

export function getDisplayState(ctx: ConnectionContext): DisplayState {
  if (ctx.state === 'connected' || ctx.state === 'degraded') {
    // lastVerifiedAt === 0 means we have never verified (e.g. brand-new SW that
    // hasn't received its first heartbeat yet). That is NOT staleness — staleness
    // means a previously-good connection has gone quiet. Fall through to the real
    // state and let the heartbeat/reconcile loop decide.
    if (ctx.lastVerifiedAt > 0) {
      const age = Date.now() - ctx.lastVerifiedAt;
      if (age > STALE_THRESHOLD_MS) {
        return 'stale';
      }
    }
  }
  return ctx.state;
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
