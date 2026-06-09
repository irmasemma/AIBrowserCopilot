import { createConnectionManager } from '../background/connection-manager';
import { createServiceDiscovery } from '../background/service-discovery';
import { dispatchTool } from '../background/tool-dispatcher';
import { createStartCoordinator } from '../background/start-coordinator';
import {
  processScanResults,
  createInitialScanState,
  getUnconfiguredTools,
  updateBadge,
} from '../background/tool-scanner';
import type { ToolScanResult, DiagnosticReason } from '../shared/types';
import { logRecord, logError } from '../shared/logger';

const ALARM_NAME = 'connection-check';
const ALARM_PERIOD_MINUTES = 0.5; // 30s — Chrome minimum for periodic alarms

// While the connection is broken AND a side panel is open (keeping the SW
// alive), poll every FAST_POLL_INTERVAL_MS instead of waiting for the next
// 30s alarm. Cuts recovery latency after the user runs the installer from
// up-to-30s to up-to-5s. We cap total fast-poll time so a long-term broken
// state (user uninstalled and walked away) doesn't burn CPU forever — once
// the cap is hit we fall back to alarm cadence.
const FAST_POLL_INTERVAL_MS = 5_000;
const FAST_POLL_MAX_DURATION_MS = 5 * 60_000;

const RECOVERABLE_REASONS: DiagnosticReason[] = [
  'no_lock_file',
  'bridge_not_started',
  'server_not_responding',
  'protocol_timeout',
];

export default defineBackground(() => {
  // SW startup is the FIRST thing the extension does after wake. Persisted
  // log entries from a prior SW life are still in chrome.storage.local —
  // they'll be flushed when the WS opens (see connection-manager onServerInfo).
  void logRecord({
    event: 'ext.sw.start',
    swStartedAt: Date.now(),
  });

  let scanState = createInitialScanState();
  const discovery = createServiceDiscovery();

  const startCoordinator = createStartCoordinator({
    attempt: () => discovery.startNativeHost(),
  });

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
          void logError('ext.tool.send_error', error, { requestId: id, tool });
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

  // Fast-poll watchdog: while we're broken, reconcile every 5s (instead of
  // waiting up to 30s for the alarm). Only runs while a side panel is open
  // (keepalive port keeps the SW from being evicted). Resets when the
  // connection recovers; caps total duration to avoid CPU burn for users who
  // uninstalled and walked away.
  let fastPollTimer: ReturnType<typeof setInterval> | null = null;
  let fastPollStartedAt = 0;
  const stopFastPoll = () => {
    if (fastPollTimer !== null) {
      clearInterval(fastPollTimer);
      fastPollTimer = null;
    }
  };
  const startFastPoll = () => {
    if (fastPollTimer !== null) return;
    fastPollStartedAt = Date.now();
    fastPollTimer = setInterval(() => {
      if (Date.now() - fastPollStartedAt > FAST_POLL_MAX_DURATION_MS) {
        stopFastPoll();
        return;
      }
      manager.reconcile().catch(() => {});
    }, FAST_POLL_INTERVAL_MS);
  };

  // Update badge on connection state changes
  manager.onStateChange((ctx) => {
    const unconfigured = getUnconfiguredTools(scanState.current);
    updateBadge(unconfigured.length, ctx.state === 'degraded');

    // Auto-recover: if we're stuck in a recoverable broken state, ask the
    // coordinator to start the bridge. The coordinator handles deduplication
    // (single-flight + cooldown + max-attempts cap).
    if (
      (ctx.state === 'reconnecting' || ctx.state === 'disconnected')
      && ctx.diagnosticReason
      && RECOVERABLE_REASONS.includes(ctx.diagnosticReason)
    ) {
      startCoordinator.tryStart().then((result) => {
        if (result.ok) {
          // Bridge spawn fired — give it a moment and reconnect.
          setTimeout(() => manager.retry(), 500);
        }
      }).catch(() => {
        // Coordinator handles its own logging; nothing to do here.
      });
    }

    // Drive the fast-poll watchdog: on while broken, off while healthy.
    const isBroken = ctx.state === 'disconnected' || ctx.state === 'reconnecting';
    if (isBroken) startFastPoll();
    else stopFastPoll();
  });

  try {
    chrome.sidePanel?.setOptions({ enabled: true });
  } catch {
    // sidePanel API may not be available in all contexts
  }

  // Side panel keepalive port. While the panel is open it holds a
  // chrome.runtime.connect port; messages flowing across that port count as
  // SW activity, preventing Chrome from evicting the SW during long
  // LLM-thinking pauses. See docs/multi-profile-tab-fanout-design.md
  // "Related symptom: connection drops during agent runs".
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'panel-keepalive') return;
    const pingHandler = () => { /* presence is the signal */ };
    port.onMessage.addListener(pingHandler);
    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(pingHandler);
    });
  });

  // AD-12: Register alarm for periodic reconciliation (survives SW suspension)
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      manager.reconcile().catch(() => {
        // Reconciliation failed — will retry on next alarm
      });
    }
  });

  // SW startup — re-establish the connection from scratch.
  // The persisted `connectionContext` may claim 'connected' but the bridge
  // could have died while the SW was asleep. We always re-discover and let
  // the result drive the UI (instead of trusting persisted state).
  (async () => {
    try {
      await manager.connect();
    } catch {
      // Connection failed (native host not running yet) — normal.
      // Alarm-based reconciliation will keep checking.
    }
  })();

  // Listen for retry/reconnect/verify/start requests from UI
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

    // User clicked "Start AgentHub service" in the popup/sidepanel.
    if (message?.type === 'start_service') {
      startCoordinator.tryStart({ userInitiated: true })
        .then((result) => {
          // After spawn, immediately re-attempt the connection so the user sees
          // status flip without waiting for the next alarm.
          if (result.ok) {
            setTimeout(() => manager.retry(), 500);
          }
          sendResponse(result);
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    // User clicked "Restart AgentHub service" in the popup/sidepanel.
    if (message?.type === 'restart_service') {
      discovery.restartNativeHost()
        .then((result) => {
          if (result.ok) setTimeout(() => manager.retry(), 1000);
          sendResponse(result);
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    // Diagnostics panel asks for a fresh service-status snapshot.
    if (message?.type === 'get_service_status') {
      discovery.getServiceStatus()
        .then((status) => sendResponse({ status }))
        .catch((err) => sendResponse({ status: null, error: String(err) }));
      return true;
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

    // Self-heal: side panel asks "is AgentHub registered with Claude Code?" and "if not, fix it."
    if (message?.type === 'check_mcp_registration') {
      discovery.checkMcpRegistration()
        .then((status) => sendResponse(status))
        .catch((err) => sendResponse({ available: false, error: String(err) }));
      return true;
    }

    if (message?.type === 'repair_mcp_registration') {
      discovery.repairMcpRegistration()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: String(err) }));
      return true;
    }

    return false;
  });
});
