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

const buildDiagnosticsText = (serverInfo: ServerInfo | null, ctx: ConnectionContext): string => {
  const uptime = ctx.lastConnectedAt ? formatUptime((Date.now() - ctx.lastConnectedAt) / 1000) : 'N/A';
  const lines: string[] = [
    `State: ${ctx.state}`,
    `Server PID: ${serverInfo?.pid ?? 'N/A'}`,
    `Port: ${serverInfo?.port ?? 'N/A'}`,
    `Version: ${serverInfo?.version ?? 'N/A'}`,
    `Uptime: ${uptime}`,
    `Started by: ${serverInfo?.startedBy ?? 'N/A'}`,
    `Reconnects this session: ${ctx.reconnectsThisSession}`,
    `Missed heartbeats: ${ctx.missedHeartbeats}`,
  ];
  if (ctx.error) {
    lines.push(`Error: ${ctx.error}`);
  }
  return lines.join('\n');
};

export const DiagnosticsPanel: FunctionalComponent<DiagnosticsPanelProps> = ({ serverInfo, connectionContext }) => {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update "now" every second for live uptime
  useEffect(() => {
    if (connectionContext.state !== 'connected' && connectionContext.state !== 'degraded') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connectionContext.state]);

  const handleCopy = async (): Promise<void> => {
    const text = buildDiagnosticsText(serverInfo, connectionContext);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="px-6 pb-3 text-xs text-neutral-500 font-mono space-y-1 border-t border-neutral-100 pt-2">
      <div class="flex justify-between items-center mb-1">
        <span class="font-semibold text-neutral-600">Diagnostics</span>
        <button
          class="text-[10px] px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy Diagnostics'}
        </button>
      </div>
      <div>PID: {serverInfo?.pid ?? 'N/A'}</div>
      <div>Port: {serverInfo?.port ?? 'N/A'}</div>
      <div>Version: {serverInfo?.version ?? 'N/A'}</div>
      <div>Uptime: {connectionContext.lastConnectedAt ? formatUptime((now - connectionContext.lastConnectedAt) / 1000) : 'N/A'}</div>
      <div>Started by: {serverInfo?.startedBy ?? 'N/A'}</div>
      <div>Reconnects: {connectionContext.reconnectsThisSession}</div>
      <div>Missed heartbeats: {connectionContext.missedHeartbeats}</div>
      {connectionContext.error && (
        <div class="text-red-500">Error: {connectionContext.error}</div>
      )}
    </div>
  );
};
