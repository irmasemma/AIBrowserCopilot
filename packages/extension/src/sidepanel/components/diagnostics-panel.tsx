import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import type { ServerInfo, ConnectionContext } from '../../shared/types.js';

export interface DiagnosticsPanelProps {
  serverInfo: ServerInfo | null;
  connectionContext: ConnectionContext;
}

export const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${secs}s`;
};

interface ServiceStatusSnapshot {
  helperVersion?: string;
  installDir?: string;
  binaryPath?: string;
  binaryExists?: boolean;
  lockFile?: {
    exists?: boolean;
    pid?: number;
    port?: number;
    version?: string;
    startedBy?: string;
    startedAt?: string;
  };
  pidAlive?: boolean | null;
  portListening?: boolean;
  wsHealthy?: boolean;
  wsHealthyError?: string;
  reportedVersion?: string;
  url?: string;
  error?: string;
}

interface DiagnosticStep {
  label: string;
  status: 'ok' | 'fail' | 'pending';
  detail?: string;
  hint?: string;
  command?: string;
}

const buildSteps = (
  s: ServiceStatusSnapshot | null,
  ctx: ConnectionContext,
  installCommand: string,
): DiagnosticStep[] => {
  const steps: DiagnosticStep[] = [];
  if (!s || s.error) {
    steps.push({
      label: 'Helper available',
      status: 'fail',
      detail: s?.error ?? 'Helper not reachable',
      hint: 'Run this in any terminal so Chrome can talk to the native messaging helper:',
      command: installCommand,
    });
    return steps;
  }
  steps.push({ label: 'Helper available', status: 'ok', detail: `v${s.helperVersion ?? 'unknown'}` });

  if (!s.binaryExists) {
    steps.push({
      label: 'Bridge binary present',
      status: 'fail',
      detail: s.binaryPath,
      hint: 'Run this in any terminal to download the bridge:',
      command: installCommand,
    });
    return steps;
  }
  steps.push({ label: 'Bridge binary present', status: 'ok', detail: s.binaryPath });

  if (!s.lockFile?.exists) {
    steps.push({
      label: 'Lock file present',
      status: 'fail',
      detail: 'No service lock file. Bridge isn\u2019t running.',
      hint: 'Use the action button in the header above to start the bridge, or re-run the installer to refresh everything:',
      command: installCommand,
    });
    return steps;
  }
  steps.push({
    label: 'Lock file present',
    status: 'ok',
    detail: `port ${s.lockFile.port}, pid ${s.lockFile.pid}, v${s.lockFile.version} (${s.lockFile.startedBy ?? 'unknown'})`,
  });

  if (s.pidAlive === false) {
    steps.push({
      label: 'Process alive',
      status: 'fail',
      detail: 'Lock file is stale — bridge process exited.',
      hint: 'Use the action button in the header above to spawn a fresh bridge, or re-run the installer to refresh everything:',
      command: installCommand,
    });
    return steps;
  }
  steps.push({ label: 'Process alive', status: 'ok' });

  if (!s.portListening) {
    steps.push({
      label: `Port ${s.lockFile.port} listening`,
      status: 'fail',
      hint: 'Restart the service.',
    });
    return steps;
  }
  steps.push({ label: `Port ${s.lockFile.port} listening`, status: 'ok' });

  if (s.wsHealthy === false) {
    const why = s.wsHealthyError ?? 'unknown';
    steps.push({
      label: 'Bridge protocol',
      status: 'fail',
      detail: `Failed: ${why}`,
      hint: why === 'timeout' || why === 'no_server_info'
        ? 'Bridge accepted the socket but never sent server_info — it may be a stale build. Restart the service.'
        : 'Restart the service to recover.',
    });
    return steps;
  }
  steps.push({
    label: 'Bridge protocol',
    status: 'ok',
    detail: s.reportedVersion ? `v${s.reportedVersion}` : undefined,
  });

  if (ctx.state === 'connected' || ctx.state === 'degraded') {
    steps.push({
      label: 'Heartbeat',
      status: ctx.missedHeartbeats > 0 ? 'fail' : 'ok',
      detail: ctx.missedHeartbeats > 0 ? `${ctx.missedHeartbeats} missed` : 'on time',
    });
  } else {
    steps.push({ label: 'Heartbeat', status: 'pending', detail: 'waiting for connection' });
  }

  return steps;
};

/**
 * Build the diagnostics text shown in the side panel + copy-to-clipboard report.
 *
 * Source-of-truth rules (precedence high → low):
 *
 *   1. WS state (connectionContext.state)
 *      - When state is 'connected'|'degraded', the WS itself proves
 *        pidAlive/portListening/wsHealthy/binaryExists. We do NOT rely
 *        on the helper's potentially-stale snapshot for these.
 *
 *   2. connectionContext.serverInfo
 *      - Live from the bridge's server_info WS frame. Updated every reconnect.
 *
 *   3. helper status snapshot (ServiceStatusSnapshot)
 *      - From chrome.runtime.sendMessage('get_service_status') → helper.
 *      - 5–40s round-trip on Windows IPC. Only authoritative source for:
 *          helperVersion, binaryPath, installDir.
 *      - For pid/port/version we PREFER serverInfo since the helper
 *        snapshot may be from a previous bridge generation.
 *      - Marked STALE if the helper-reported pid differs from the
 *        WS-reported pid (bridge restarted but helper hasn't repolled yet).
 *
 * Source annotations are appended to each line so a reader (and a future
 * LLM helping debug) knows whether a value is live, derived, or potentially
 * stale.
 */
const buildDiagnosticsText = (
  serverInfo: ServerInfo | null,
  ctx: ConnectionContext,
  status: ServiceStatusSnapshot | null,
  statusFetchedAt: number | null,
): string => {
  const wsHealthy = ctx.state === 'connected' || ctx.state === 'degraded';
  const helperStale = statusIsStale(serverInfo, status);
  const helperAgeSec = statusFetchedAt ? Math.floor((Date.now() - statusFetchedAt) / 1000) : null;
  const helperSrc = (() => {
    if (!status) return '(not fetched)';
    if (status.error) return `(helper error: ${status.error})`;
    if (helperStale) return `(helper, stale — was for pid ${status.lockFile?.pid})`;
    return helperAgeSec != null ? `(helper, ${helperAgeSec}s ago)` : '(helper)';
  })();
  const uptime = ctx.lastConnectedAt ? formatUptime((Date.now() - ctx.lastConnectedAt) / 1000) : 'N/A';

  // Helper for picking the freshest value with source tag
  const wsOrStale = <T,>(wsVal: T | undefined, staleVal: T | undefined, formatter: (v: T) => string = String): string => {
    if (wsVal !== undefined && wsVal !== null) return `${formatter(wsVal)} (live WS)`;
    if (staleVal !== undefined && staleVal !== null) return `${formatter(staleVal)} (lock file)`;
    return 'N/A';
  };

  const lines: string[] = [
    `State: ${ctx.state}`,
    `Diagnostic reason: ${ctx.diagnosticReason ?? 'none'}`,
    `Server PID: ${wsOrStale(serverInfo?.pid, status?.lockFile?.pid)}`,
    `Port: ${wsOrStale(serverInfo?.port, status?.lockFile?.port)}`,
    `Version: ${wsOrStale(serverInfo?.version, status?.lockFile?.version)}`,
    `Build: ${serverInfo?.buildId ? `${serverInfo.buildId} (live WS)` : 'N/A'}`,
    `Uptime: ${uptime} (since last reconnect)`,
    `Started by: ${wsOrStale(serverInfo?.startedBy, status?.lockFile?.startedBy)}`,
    `Browsers: ${serverInfo?.connectedBrowsers?.join(', ') ?? 'N/A'}${serverInfo?.connectedBrowsers ? ' (live WS)' : ''}`,
    `MCP clients: ${serverInfo?.connectedStubs ?? 'N/A'}${serverInfo?.connectedStubs !== undefined ? ' (live WS)' : ''}`,
    `Reconnects this session: ${ctx.reconnectsThisSession}`,
    `Missed heartbeats: ${ctx.missedHeartbeats}`,
    `Helper version: ${status?.helperVersion ?? 'N/A'} ${helperSrc}`,
    `Binary path: ${status?.binaryPath ?? 'N/A'} (${status?.binaryExists ? 'present' : status ? 'missing' : 'unknown'}) ${helperSrc}`,
    // Derived from WS state when healthy — these are tautologically true if
    // the bridge can serve a WS to us at all.
    `PID alive: ${wsHealthy ? 'true (derived from live WS)' : (status?.pidAlive != null ? `${status.pidAlive} ${helperSrc}` : 'N/A')}`,
    `Port listening: ${wsHealthy ? 'true (derived from live WS)' : (status?.portListening != null ? `${status.portListening} ${helperSrc}` : 'N/A')}`,
    `WS healthy: ${wsHealthy ? 'true (live WS open)' : (status?.wsHealthy != null ? `${status.wsHealthy} ${helperSrc}${status.wsHealthyError ? ` (${status.wsHealthyError})` : ''}` : 'N/A')}`,
  ];
  if (helperStale) {
    lines.push('');
    lines.push('NOTE: helper snapshot is stale (bridge restarted since last poll). Click Refresh.');
  }
  if (ctx.error) lines.push(`Error: ${ctx.error}`);
  return lines.join('\n');
};

/**
 * Returns true when the helper-reported pid differs from the WS-reported
 * pid. Means the helper status is from a previous bridge generation and
 * should be flagged as stale until the next helper invoke completes.
 */
const statusIsStale = (serverInfo: ServerInfo | null, status: ServiceStatusSnapshot | null): boolean => {
  if (!serverInfo || !status?.lockFile?.pid) return false;
  return serverInfo.pid !== status.lockFile.pid;
};

const StepRow: FunctionalComponent<{ step: DiagnosticStep }> = ({ step }) => {
  const [copied, setCopied] = useState(false);
  const icon = step.status === 'ok' ? '✓' : step.status === 'fail' ? '✕' : '·';
  const color = step.status === 'ok' ? 'text-emerald-600'
    : step.status === 'fail' ? 'text-red-600'
    : 'text-neutral-400';

  const handleCopy = async (cmd: string): Promise<void> => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex items-start gap-2 py-0.5">
      <span class={`${color} font-mono w-3 flex-shrink-0`} aria-hidden="true">{icon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-x-2 items-baseline">
          <span class="text-neutral-700">{step.label}</span>
          {step.detail && <span class="text-neutral-500 text-[11px] font-mono truncate">{step.detail}</span>}
        </div>
        {step.hint && step.status === 'fail' && (
          <div class="text-[11px] text-amber-700 mt-0.5">{step.hint}</div>
        )}
        {step.command && step.status === 'fail' && (
          <div class="relative mt-1">
            <pre class="text-[11px] bg-neutral-900 text-green-400 p-1.5 pr-12 rounded font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {step.command}
            </pre>
            <button
              class="absolute top-0.5 right-0.5 text-[10px] text-neutral-300 bg-neutral-800 px-1.5 py-0.5 rounded border border-neutral-700 hover:text-white"
              onClick={() => void handleCopy(step.command!)}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const DiagnosticsPanel: FunctionalComponent<DiagnosticsPanelProps> = ({ serverInfo, connectionContext }) => {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<ServiceStatusSnapshot | null>(null);
  const [statusFetchedAt, setStatusFetchedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Always-available manual recovery. The state-derived header buttons only
  // appear for KNOWN-broken states; this covers the dangerous "UI says
  // connected but tools time out" case (e.g. a wedged SW or a relay the
  // bridge silently dropped), where the diagnostics panel is the only
  // surface the user can reach. Sends restart_service → the helper kills and
  // respawns the bridge, forcing every browser to reconnect cleanly.
  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await chrome.runtime.sendMessage({ type: 'restart_service', userInitiated: true }).catch(() => null);
      // Give the bridge a moment to come back, then force a reconcile + refresh.
      await new Promise((r) => setTimeout(r, 1200));
      await chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => null);
      await refresh();
    } finally {
      setTimeout(() => setRestarting(false), 600);
    }
  };

  /**
   * Pull a status snapshot. Two paths:
   *
   *   1. WS is healthy + we know the bridge port → fetch /api/state directly
   *      (fast: ~10ms, always live). The bridge already serves the same data
   *      we'd ask the helper for; we just convert /api/state's shape into
   *      ServiceStatusSnapshot for backwards compatibility with the UI code.
   *
   *   2. WS is broken or port unknown → fall back to the helper via the SW
   *      (slow: 5-40s on Windows due to native-messaging IPC). This is the
   *      only path that can answer "is the binary present?" when the bridge
   *      itself can't respond.
   *
   * Path 1 was added in v0.5.10 to fix the recurring "Helper version: N/A"
   * panel display caused by slow helper invocations leaving a NULL snapshot.
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      const port = serverInfo?.port;
      const wsHealthy = connectionContext.state === 'connected' || connectionContext.state === 'degraded';
      if (wsHealthy && port) {
        // Fast path — fetch directly from the bridge.
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/state`);
          if (r.ok) {
            const data = await r.json() as {
              bridge: { version: string; buildId: string; pid: number; port: number; uptimeSec: number; startedBy: string };
            };
            // Convert /api/state → ServiceStatusSnapshot. Most "helper"
            // fields are derived from the WS state (which is alive by
            // definition). Helper-only fields (helperVersion, binaryPath)
            // are not available via this path — keep their last known
            // value if we have one, otherwise leave empty.
            setStatus((prev) => ({
              ...(prev ?? {}),
              lockFile: {
                exists: true,
                pid: data.bridge.pid,
                port: data.bridge.port,
                version: data.bridge.version,
                startedBy: data.bridge.startedBy,
              },
              pidAlive: true,
              portListening: true,
              wsHealthy: true,
              binaryExists: true,
              reportedVersion: data.bridge.version,
              url: `ws://127.0.0.1:${data.bridge.port}/`,
            }));
            setStatusFetchedAt(Date.now());
            return;
          }
          // Non-2xx → fall through to helper path
        } catch {
          // Network error → fall through to helper path
        }
      }
      // Slow path — go through SW to the helper.
      const res = await chrome.runtime.sendMessage({ type: 'get_service_status' });
      if (res && typeof res === 'object' && res.status && typeof res.status === 'object') {
        setStatus(res.status as ServiceStatusSnapshot);
        setStatusFetchedAt(Date.now());
      } else {
        const errMsg = res && typeof res === 'object' && typeof res.error === 'string'
          ? res.error
          : 'Helper returned no data';
        setStatus({ error: errMsg });
        setStatusFetchedAt(Date.now());
      }
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : String(err) });
      setStatusFetchedAt(Date.now());
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Re-fetch periodically while panel is open so it stays current.
    //
    // Cadence depends on whether the bridge is reachable:
    //   - Healthy (state=connected|degraded): poll every 30s. The WS itself
    //     is the live signal; helper provides supplementary info (binary
    //     path, helper version) that rarely changes. Polling fast wastes
    //     CPU on the Windows native-messaging IPC tax (5-40s per call).
    //   - Broken (any other state): poll every 5s so the panel converges
    //     quickly once the user runs `npx agenthub-setup`.
    const isHealthy = connectionContext.state === 'connected' || connectionContext.state === 'degraded';
    const intervalMs = isHealthy ? 30_000 : 5_000;
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
    // Note: this effect re-runs whenever the healthy/broken transition
    // flips, so the interval cadence adjusts in real time.
  }, [connectionContext.state]);

  useEffect(() => {
    if (connectionContext.state !== 'connected' && connectionContext.state !== 'degraded') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connectionContext.state]);

  const handleCopy = async (): Promise<void> => {
    const text = buildDiagnosticsText(serverInfo, connectionContext, status, statusFetchedAt);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extId = chrome.runtime?.id ?? '';
  const installCommand = extId
    ? `npx agenthub-setup@latest --update --extension-id ${extId}`
    : 'npx agenthub-setup@latest --update';
  const steps = buildSteps(status, connectionContext, installCommand);

  // The bridge serves its full diagnostics dashboard (live state, per-request
  // drill-down, log tails) at http://127.0.0.1:<port>/. Open it in a real tab.
  // Always clickable: the dashboard is served by the BRIDGE PROCESS, not by the
  // extension's relay connection. A lost/flapping relay is exactly when the
  // user needs to open it to debug. If the bridge is truly down, the new tab
  // shows connection-refused — which is itself useful signal. Port falls back
  // to the default when we have no live serverInfo.
  const dashboardPort = serverInfo?.port ?? status?.lockFile?.port ?? 7483;
  const dashboardUrl = `http://127.0.0.1:${dashboardPort}/`;
  const openDashboard = (): void => {
    try { chrome.tabs.create({ url: dashboardUrl }); } catch { window.open(dashboardUrl, '_blank'); }
  };

  return (
    <div class="px-4 pb-3 text-xs text-neutral-700 border-t border-neutral-100 pt-3 bg-neutral-50/50">
      <div class="flex justify-between items-center mb-2">
        <span class="font-semibold text-neutral-700">Connection diagnostics</span>
        <div class="flex gap-2">
          <button
            class="text-[10px] px-2 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 text-neutral-600 transition-colors"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Checking…' : 'Refresh'}
          </button>
          <button
            class="text-[10px] px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
            onClick={() => void handleCopy()}
          >
            {copied ? 'Copied!' : 'Copy report'}
          </button>
          <button
            class="text-[10px] px-2 py-0.5 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-colors disabled:opacity-50"
            onClick={() => void handleRestart()}
            disabled={restarting}
            title="Kill and respawn the bridge, then reconnect. Use this if tools time out even though the status looks connected."
          >
            {restarting ? 'Restarting…' : 'Restart bridge'}
          </button>
        </div>
      </div>

      {/* Entry point to the bridge's full diagnostics dashboard (served at
          http://127.0.0.1:<port>/). Opens in a real browser tab. */}
      <button
        type="button"
        onClick={openDashboard}
        title={`Open the bridge diagnostics dashboard (${dashboardUrl})`}
        data-testid="open-dashboard"
        class="w-full mb-2 flex items-center gap-2.5 rounded-md border border-brand-primary bg-white px-3 py-2 text-left transition-colors hover:bg-neutral-50"
      >
        <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-primary text-white text-[13px]" aria-hidden="true">{'▦'}</span>
        <span class="min-w-0 flex-1">
          <span class="block text-[11px] font-semibold text-neutral-800">Open diagnostics dashboard</span>
          <span class="block text-[10px] text-neutral-500 truncate">Live state, request traces &amp; logs</span>
        </span>
        <span class="text-brand-primary text-sm" aria-hidden="true">{'↗'}</span>
      </button>

      <div class="mb-2 space-y-0.5">
        {steps.map((step, i) => <StepRow key={i} step={step} />)}
      </div>

      <details class="mt-2 text-[11px]">
        <summary class="cursor-pointer text-neutral-500 hover:text-neutral-700 select-none">
          Runtime details
        </summary>
        <div class="mt-1 pl-3 space-y-0.5 font-mono text-neutral-500">
          <div>State: {connectionContext.state}{connectionContext.diagnosticReason ? ` · ${connectionContext.diagnosticReason}` : ''}</div>
          <div>Version: {serverInfo?.version ? `${serverInfo.version} (live)` : (status?.lockFile?.version ? `${status.lockFile.version} (lock file)` : 'N/A')} · build {serverInfo?.buildId ?? 'N/A'}</div>
          <div>Uptime: {connectionContext.lastConnectedAt ? formatUptime((now - connectionContext.lastConnectedAt) / 1000) : 'N/A'}</div>
          <div>Browsers: {serverInfo?.connectedBrowsers?.join(', ') || 'N/A'}</div>
          <div>MCP clients: {serverInfo?.connectedStubs ?? 'N/A'}</div>
          <div>Reconnects: {connectionContext.reconnectsThisSession} · Missed heartbeats: {connectionContext.missedHeartbeats}</div>
          {statusFetchedAt && (
            <div class={statusIsStale(serverInfo, status) ? 'text-amber-600' : 'text-neutral-400'}>
              Helper snapshot: {Math.floor((now - statusFetchedAt) / 1000)}s ago
              {statusIsStale(serverInfo, status) ? ' · stale (bridge restarted)' : ''}
            </div>
          )}
          {connectionContext.error && <div class="text-red-500">Error: {connectionContext.error}</div>}
        </div>
      </details>
    </div>
  );
};
