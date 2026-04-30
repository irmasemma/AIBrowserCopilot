import { createConnectionManager } from '../background/connection-manager';
import { createServiceDiscovery } from '../background/service-discovery';
import { dispatchTool } from '../background/tool-dispatcher';
import {
  processScanResults,
  createInitialScanState,
  getUnconfiguredTools,
  updateBadge,
} from '../background/tool-scanner';
import type { ToolScanResult } from '../shared/types';

const ALARM_NAME = 'connection-check';
const ALARM_PERIOD_MINUTES = 0.5; // 30s — Chrome minimum for periodic alarms

export default defineBackground(() => {
  let scanState = createInitialScanState();
  const discovery = createServiceDiscovery();

  const manager = createConnectionManager({
    discoverUrl: () => discovery.discoverEndpoint(),
    onToolRequest(id, tool, params) {
      dispatchTool(tool, params)
        .then((result) => {
          manager.getRelay()?.sendToolResponse(id, result);
          // Track last tool call
          chrome.storage.local.get('connectionContext', (stored) => {
            if (stored.connectionContext) {
              chrome.storage.local.set({
                connectionContext: { ...stored.connectionContext, lastToolCall: Date.now() },
              });
            }
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Unknown error';
          const code = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
          manager.getRelay()?.sendToolError(id, { message, code });
        });
    },

    onToolScan(tools: ToolScanResult[]) {
      scanState = processScanResults(scanState, tools);
      chrome.storage.local.set({
        toolScanResults: scanState.current,
        toolScanTimestamp: scanState.timestamp,
      });
      const unconfigured = getUnconfiguredTools(tools);
      const ctx = manager.getContext();
      updateBadge(unconfigured.length, ctx.state === 'degraded');
    },
  });

  // Update badge on connection state changes
  manager.onStateChange((ctx) => {
    const unconfigured = getUnconfiguredTools(scanState.current);
    updateBadge(unconfigured.length, ctx.state === 'degraded');
  });

  try {
    chrome.sidePanel?.setOptions({ enabled: true });
  } catch {
    // sidePanel API may not be available in all contexts
  }

  // AD-12: Register alarm for periodic reconciliation (survives SW suspension)
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      manager.reconcile().catch(() => {
        // Reconciliation failed — will retry on next alarm
      });
    }
  });

  // AD-16: SW startup — re-establish the connection from scratch.
  // When the SW restarts (after termination, extension reload, or Chrome restart) the
  // in-memory relay is always null and the in-memory context starts as 'disconnected'.
  // The persisted `connectionContext` may still claim 'connected', but that's stale —
  // the only way to know if the native host is still up is to actually try connecting.
  // We always call connect(); discovery + WS will either succeed (state→connected) or
  // fail quickly (state→reconnecting, alarm retries via backoff).
  (async () => {
    try {
      await manager.connect();
    } catch {
      // Connection failed (native host not running yet) — normal.
      // Alarm-based reconciliation will keep checking.
    }
  })();

  // Listen for retry/reconnect/verify requests from UI
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'retry_connection' || message?.type === 'reconnect') {
      manager.retry();
      sendResponse({ ok: true });
      return false;
    }

    // AD-14: Side panel verification — wakes SW and forces immediate reconcile
    if (message?.type === 'verify_connection') {
      manager.reconcile()
        .then(() => sendResponse({ done: true }))
        .catch(() => sendResponse({ done: false }));
      return true; // async response
    }

    // In-extension chat agent dispatches tools via the same handler that MCP uses.
    if (message?.type === 'dispatch_tool' && typeof message.name === 'string') {
      dispatchTool(message.name, (message.params ?? {}) as Record<string, unknown>)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error: unknown) => {
          const errMessage = error instanceof Error ? error.message : 'Unknown error';
          const code = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
          sendResponse({ ok: false, error: { message: errMessage, code } });
        });
      return true; // async response
    }

    return false;
  });
});
