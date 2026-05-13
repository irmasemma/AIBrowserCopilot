import type { ConnectionContext, ServerInfo, ToolScanResult, DiagnosticReason } from '../shared/types';
import { transition, createInitialContext } from './connection-machine';
import type { ConnectionEvent } from './connection-machine';
import { createBackoffTimer } from './backoff-manager';
import { createHeartbeatMonitor, DEFAULT_HEARTBEAT_CONFIG } from './heartbeat-monitor';
import type { HeartbeatMonitor } from './heartbeat-monitor';
import { createRelay } from './relay-client';
import type { Relay } from './relay-client';
import type { DiscoveryResult } from './service-discovery';
import { checkBridgeVersion } from '../shared/version-check';

const DEFAULT_URL = 'ws://127.0.0.1:7483';
const SERVER_INFO_TIMEOUT_MS = 10_000;

export type ToolRequestHandler = (id: string, tool: string, params: Record<string, unknown>) => void;
export type ToolScanHandler = (tools: ToolScanResult[]) => void;
export type DiscoverUrlFn = () => Promise<DiscoveryResult>;

export interface ConnectionManagerOptions {
  onToolRequest?: ToolRequestHandler;
  onToolScan?: ToolScanHandler;
  discoverUrl?: DiscoverUrlFn;
}

export interface ConnectionManager {
  connect(url?: string): Promise<void>;
  disconnect(): void;
  retry(): void;
  reconcile(): Promise<void>;
  isRelayAlive(): boolean;
  getContext(): ConnectionContext;
  getRelay(): Relay | null;
  onStateChange(listener: (ctx: ConnectionContext) => void): () => void;
}

function persistContext(ctx: ConnectionContext): void {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({
        connectionContext: ctx,
        connectionState: { state: ctx.state, lastConnected: ctx.lastConnectedAt, error: ctx.error },
      });
    }
  } catch {
    // Ignore — may not be in Chrome environment
  }
}

export function createConnectionManager(options: ConnectionManagerOptions = {}): ConnectionManager {
  let context: ConnectionContext = createInitialContext();
  let relay: Relay | null = null;
  let heartbeat: HeartbeatMonitor | null = null;
  const backoffTimer = createBackoffTimer();
  let serverInfoTimer: ReturnType<typeof setTimeout> | null = null;
  let currentUrl: string = DEFAULT_URL;

  const listeners = new Set<(ctx: ConnectionContext) => void>();

  function dispatch(event: ConnectionEvent): void {
    const prev = context;
    context = transition(context, event);
    if (context !== prev) {
      persistContext(context);
      for (const listener of listeners) {
        listener(context);
      }
    }
  }

  function stopAll(): void {
    heartbeat?.stop();
    heartbeat = null;
    backoffTimer.cancel();
    if (serverInfoTimer !== null) {
      clearTimeout(serverInfoTimer);
      serverInfoTimer = null;
    }
  }

  function scheduleBackoff(): void {
    backoffTimer.schedule(context.failureCount, () => {
      dispatch({ type: 'BACKOFF_EXPIRED' });
      refreshUrl().then(() => openRelay());
    });
  }

  // Diagnostics that name a specific recoverable failure. Surface these as-is
  // (even after a prior successful connection) so the UI shows the actionable
  // button ("Start Pilotwave service", "Restart service", "Copy install command")
  // instead of the generic "Lost connection — Reopen autostart to reconnect"
  // and so the SW's auto-recovery loop (background.ts:RECOVERABLE_REASONS)
  // can fire.
  const ACTIONABLE_REASONS: DiagnosticReason[] = [
    'no_lock_file',
    'bridge_not_started',
    'server_not_responding',
    'protocol_timeout',
    'helper_unavailable',
  ];

  function setDiagnostic(reason: DiagnosticReason): void {
    // After a successful connection, if the new reason isn't itself actionable,
    // surface 'was_connected' so the UI tells the user how to reconnect.
    // Actionable reasons pass through so recovery can drive the fix.
    const effectiveReason =
      context.serverInfo !== null && reason !== 'connecting' && !ACTIONABLE_REASONS.includes(reason)
        ? 'was_connected'
        : reason;
    if (context.diagnosticReason !== effectiveReason) {
      context = { ...context, diagnosticReason: effectiveReason };
      persistContext(context);
      for (const listener of listeners) {
        listener(context);
      }
    }
  }

  async function refreshUrl(): Promise<void> {
    if (!options.discoverUrl) return;
    try {
      const result = await options.discoverUrl();
      const urlChanged = result.url !== currentUrl;
      currentUrl = result.url;
      setDiagnostic(result.diagnostic);
      // If the server appeared (lock file found after being gone, or URL changed),
      // reset failure count so next attempt is immediate — don't make the user wait 30s
      if (urlChanged || (result.diagnostic === 'connecting' && context.failureCount > 2)) {
        context = { ...context, failureCount: 0 };
      }
    } catch {
      // Keep current URL if discovery fails
    }
  }

  function openRelay(): void {
    relay = createRelay({
      onOpen() {
        // Wait for server_info before dispatching WS_OPEN
        serverInfoTimer = setTimeout(() => {
          serverInfoTimer = null;
          relay?.disconnect();
        }, SERVER_INFO_TIMEOUT_MS);
      },

      onServerInfo(info: ServerInfo) {
        if (serverInfoTimer !== null) {
          clearTimeout(serverInfoTimer);
          serverInfoTimer = null;
        }
        const versionStatus = checkBridgeVersion(info.version);
        context = {
          ...context,
          serverInfo: info,
          lastConnectedAt: Date.now(),
          lastVerifiedAt: Date.now(),
          versionStatus,
        };
        dispatch({ type: 'WS_OPEN' });
        startHeartbeat();
      },

      onPong(timestamp: number) {
        heartbeat?.receivePong(timestamp);
        context = { ...context, lastVerifiedAt: Date.now() };
        dispatch({ type: 'HEARTBEAT_OK' });
      },

      onClose(_code: number, _reason: string) {
        if (serverInfoTimer !== null) {
          clearTimeout(serverInfoTimer);
          serverInfoTimer = null;
        }
        heartbeat?.stop();
        heartbeat = null;
        relay = null;
        // Set diagnostic immediately — don't wait for next discovery cycle
        if (context.serverInfo !== null) {
          setDiagnostic('was_connected');
        }
        dispatch({ type: 'WS_CLOSE' });
        // Schedule backoff if we're in reconnecting state
        if (context.state === 'reconnecting') {
          scheduleBackoff();
        }
      },

      onError(_error: Event) {
        if (context.state === 'connecting') {
          // If diagnostic was 'connecting' (lock file said server exists), but WS failed → server not responding
          if (context.diagnosticReason === 'connecting') {
            setDiagnostic('server_not_responding');
          }
          dispatch({ type: 'WS_ERROR' });
          // Safety: if onClose doesn't fire after onError, ensure backoff is scheduled.
          // Some WebSocket implementations may not fire close after error.
          if (context.state === 'reconnecting') {
            scheduleBackoff();
          }
        }
      },

      onToolRequest(id: string, tool: string, params: Record<string, unknown>) {
        options.onToolRequest?.(id, tool, params);
      },

      onToolScan(tools) {
        options.onToolScan?.(tools);
      },
    });

    relay.connect(currentUrl);
  }

  function startHeartbeat(): void {
    heartbeat = createHeartbeatMonitor(DEFAULT_HEARTBEAT_CONFIG, {
      sendPing() {
        relay?.sendPing(Date.now());
      },
      onMiss() {
        dispatch({ type: 'HEARTBEAT_MISS' });
      },
      onDead() {
        dispatch({ type: 'HEARTBEAT_MISS' });
        relay?.disconnect();
      },
    });
    heartbeat.start();
  }

  return {
    async connect(url?: string): Promise<void> {
      currentUrl = url ?? DEFAULT_URL;
      dispatch({ type: 'CONNECT' });
      // Always try discovery before connecting — the lock file may have
      // a different port than DEFAULT_URL, and native host may not be running yet
      await refreshUrl();
      openRelay();
    },

    disconnect(): void {
      stopAll();
      dispatch({ type: 'DISCONNECT' });
      if (relay) {
        const r = relay;
        relay = null;
        r.disconnect();
      }
    },

    retry(): void {
      stopAll();
      dispatch({ type: 'CONNECT' });
      refreshUrl().then(() => openRelay());
    },

    async reconcile(): Promise<void> {
      // Layer 2/3/6: Verify in-memory relay matches persisted state.
      // Called by alarm, SW init, and verify_connection message.
      if (relay !== null && relay.isConnected()) {
        // Relay alive in memory — send a ping to confirm and update lastVerifiedAt
        relay.sendPing(Date.now());
        return;
      }

      // Relay is dead in memory. Check if persisted state claims we're connected.
      if (context.state === 'connected' || context.state === 'degraded' || context.state === 'reconnecting') {
        // Persisted state is lying. Attempt rediscovery.
        stopAll();
        await refreshUrl();

        // If discovery found a live server (diagnostic === 'connecting'), try to reconnect
        if (context.diagnosticReason === 'connecting') {
          dispatch({ type: 'CONNECT' });
          openRelay();
        } else {
          // No server found — transition to disconnected
          dispatch({ type: 'DISCONNECT' });
        }
      }
    },

    isRelayAlive(): boolean {
      return relay !== null && relay.isConnected();
    },

    getContext(): ConnectionContext {
      return context;
    },

    getRelay(): Relay | null {
      return relay;
    },

    onStateChange(listener: (ctx: ConnectionContext) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
