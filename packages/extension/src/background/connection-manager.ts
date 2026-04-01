import type { ConnectionContext, ServerInfo, ToolScanResult } from '../shared/types';
import { transition, createInitialContext } from './connection-machine';
import type { ConnectionEvent } from './connection-machine';
import { createBackoffTimer } from './backoff-manager';
import { createHeartbeatMonitor, DEFAULT_HEARTBEAT_CONFIG } from './heartbeat-monitor';
import type { HeartbeatMonitor } from './heartbeat-monitor';
import { createRelay } from './relay-client';
import type { Relay } from './relay-client';

const DEFAULT_URL = 'ws://127.0.0.1:7483';
const SERVER_INFO_TIMEOUT_MS = 10_000;

export type ToolRequestHandler = (id: string, tool: string, params: Record<string, unknown>) => void;
export type ToolScanHandler = (tools: ToolScanResult[]) => void;
export type DiscoverUrlFn = () => Promise<{ url: string; token?: string }>;

export interface ConnectionManagerOptions {
  onToolRequest?: ToolRequestHandler;
  onToolScan?: ToolScanHandler;
  discoverUrl?: DiscoverUrlFn;
}

export interface ConnectionManager {
  connect(url?: string): Promise<void>;
  disconnect(): void;
  retry(): void;
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

  let isFirstConnect = true;

  async function refreshUrl(): Promise<void> {
    if (isFirstConnect || !options.discoverUrl) return;
    try {
      const { url } = await options.discoverUrl();
      currentUrl = url;
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
        context = { ...context, serverInfo: info, lastConnectedAt: Date.now() };
        dispatch({ type: 'WS_OPEN' });
        startHeartbeat();
      },

      onPong(timestamp: number) {
        heartbeat?.receivePong(timestamp);
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
        dispatch({ type: 'WS_CLOSE' });
        // Schedule backoff if we're in reconnecting state
        if (context.state === 'reconnecting') {
          scheduleBackoff();
        }
      },

      onError(_error: Event) {
        if (context.state === 'connecting') {
          dispatch({ type: 'WS_ERROR' });
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
      isFirstConnect = true;
      dispatch({ type: 'CONNECT' });
      openRelay();
      isFirstConnect = false;
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
