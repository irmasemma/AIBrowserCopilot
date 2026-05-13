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
      hint: 'Click "Start CoPilot service" in the header.',
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
      hint: 'Click "Start CoPilot service" to spawn a fresh bridge.',
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

const buildDiagnosticsText = (
  serverInfo: ServerInfo | null,
  ctx: ConnectionContext,
  status: ServiceStatusSnapshot | null,
): string => {
  const uptime = ctx.lastConnectedAt ? formatUptime((Date.now() - ctx.lastConnectedAt) / 1000) : 'N/A';
  const lines: string[] = [
    `State: ${ctx.state}`,
    `Diagnostic reason: ${ctx.diagnosticReason ?? 'none'}`,
    `Server PID: ${serverInfo?.pid ?? status?.lockFile?.pid ?? 'N/A'}`,
    `Port: ${serverInfo?.port ?? status?.lockFile?.port ?? 'N/A'}`,
    `Version: ${serverInfo?.version ?? status?.lockFile?.version ?? 'N/A'}`,
    `Build: ${serverInfo?.buildId ?? 'N/A'}`,
    `Uptime: ${uptime}`,
    `Started by: ${serverInfo?.startedBy ?? status?.lockFile?.startedBy ?? 'N/A'}`,
    `Browsers: ${serverInfo?.connectedBrowsers?.join(', ') || 'N/A'}`,
    `MCP clients: ${serverInfo?.connectedStubs ?? 'N/A'}`,
    `Reconnects this session: ${ctx.reconnectsThisSession}`,
    `Missed heartbeats: ${ctx.missedHeartbeats}`,
    `Helper version: ${status?.helperVersion ?? 'N/A'}`,
    `Binary path: ${status?.binaryPath ?? 'N/A'} (${status?.binaryExists ? 'present' : 'missing'})`,
    `PID alive: ${status?.pidAlive ?? 'N/A'}`,
    `Port listening: ${status?.portListening ?? 'N/A'}`,
    `WS healthy: ${status?.wsHealthy ?? 'N/A'}${status?.wsHealthyError ? ` (${status.wsHealthyError})` : ''}`,
  ];
  if (ctx.error) lines.push(`Error: ${ctx.error}`);
  return lines.join('\n');
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
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Background wraps the snapshot in { status, error? }, so unwrap here.
      // Reading res directly leaves every field undefined, which used to surface
      // as a false "Bridge binary present ✕ Re-run the installer" failure.
      const res = await chrome.runtime.sendMessage({ type: 'get_service_status' });
      if (res && typeof res === 'object' && res.status && typeof res.status === 'object') {
        setStatus(res.status as ServiceStatusSnapshot);
      } else {
        const errMsg = res && typeof res === 'object' && typeof res.error === 'string'
          ? res.error
          : 'Helper returned no data';
        setStatus({ error: errMsg });
      }
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Re-fetch periodically while panel is open so it stays current.
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (connectionContext.state !== 'connected' && connectionContext.state !== 'degraded') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connectionContext.state]);

  const handleCopy = async (): Promise<void> => {
    const text = buildDiagnosticsText(serverInfo, connectionContext, status);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extId = chrome.runtime?.id ?? '';
  const installCommand = extId
    ? `npx pilotwave-setup --update --extension-id ${extId}`
    : 'npx pilotwave-setup --update';
  const steps = buildSteps(status, connectionContext, installCommand);

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
        </div>
      </div>

      <div class="mb-2 space-y-0.5">
        {steps.map((step, i) => <StepRow key={i} step={step} />)}
      </div>

      <details class="mt-2 text-[11px]">
        <summary class="cursor-pointer text-neutral-500 hover:text-neutral-700 select-none">
          Runtime details
        </summary>
        <div class="mt-1 pl-3 space-y-0.5 font-mono text-neutral-500">
          <div>State: {connectionContext.state}{connectionContext.diagnosticReason ? ` · ${connectionContext.diagnosticReason}` : ''}</div>
          <div>Version: {serverInfo?.version ?? status?.lockFile?.version ?? 'N/A'} · build {serverInfo?.buildId ?? 'N/A'}</div>
          <div>Uptime: {connectionContext.lastConnectedAt ? formatUptime((now - connectionContext.lastConnectedAt) / 1000) : 'N/A'}</div>
          <div>Browsers: {serverInfo?.connectedBrowsers?.join(', ') || 'N/A'}</div>
          <div>MCP clients: {serverInfo?.connectedStubs ?? 'N/A'}</div>
          <div>Reconnects: {connectionContext.reconnectsThisSession} · Missed heartbeats: {connectionContext.missedHeartbeats}</div>
          {connectionContext.error && <div class="text-red-500">Error: {connectionContext.error}</div>}
        </div>
      </details>
    </div>
  );
};
