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

export type DiagnosticReason =
  | 'connecting'
  | 'no_lock_file'
  | 'server_not_responding'
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
  diagnosticReason: DiagnosticReason | null;
  lastVerifiedAt: number;
}

export type DisplayState = ConnectionState | 'stale';

/** Threshold in ms — if lastVerifiedAt is older than this, state is stale */
export const STALE_THRESHOLD_MS = 40_000;

/**
 * Minimum native-host version this extension knows how to talk to. Anything
 * older means the user has a pre-Phase-1 monolithic binary installed; the
 * extension will still connect but flag it so the user knows to re-run the
 * installer to get the multi-client architecture.
 */
export const MIN_NATIVE_HOST_VERSION = '0.2.0';

export function isOutdatedNativeHostVersion(version: string | undefined | null): boolean {
  if (!version) return false;
  const v = version.split('.').map(n => Number.parseInt(n, 10));
  const m = MIN_NATIVE_HOST_VERSION.split('.').map(n => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    const a = Number.isFinite(v[i]) ? v[i] : 0;
    const b = Number.isFinite(m[i]) ? m[i] : 0;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

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
