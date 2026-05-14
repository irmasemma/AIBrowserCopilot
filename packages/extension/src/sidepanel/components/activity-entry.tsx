import type { FunctionalComponent } from 'preact';
import type { ActivityEntry as ActivityEntryType } from '../../shared/types.js';

interface ActivityEntryProps {
  entry: ActivityEntryType;
}

interface StatusUi {
  icon: string;
  color: string;
  label: string;
}

const STATUS_DISPLAY: Record<string, StatusUi> = {
  success:       { icon: '✓', color: 'text-log-meta', label: 'ok' },
  error:         { icon: '✕', color: 'text-red-400', label: 'err' },
  blocked:       { icon: '⊘', color: 'text-red-400', label: 'blocked' },
  'in-progress': { icon: '…', color: 'text-amber-300', label: 'running' },
};

const formatHostname = (url: string | null, maxLen = 32): string => {
  if (!url) return '—';
  try {
    const u = new URL(url);
    const path = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    return path.length > maxLen ? path.slice(0, maxLen) + '…' : path;
  } catch {
    return url.slice(0, maxLen);
  }
};

const formatTimestamp = (timestamp: number): string => {
  const d = new Date(timestamp);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

const formatRelativeTime = (timestamp: number): string => {
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 60_000) return `${Math.max(1, Math.round(age / 1000))}s ago`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`;
  return `${Math.round(age / 86_400_000)}d ago`;
};

const formatDuration = (ms: number | null): string => {
  if (ms === null || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const ActivityEntryComponent: FunctionalComponent<ActivityEntryProps> = ({ entry }) => {
  const status = STATUS_DISPLAY[entry.status] ?? STATUS_DISPLAY.error;
  const duration = formatDuration(entry.duration);
  const target = formatHostname(entry.targetUrl);
  const ts = formatTimestamp(entry.timestamp);
  const relTime = formatRelativeTime(entry.timestamp);

  return (
    <div
      class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 px-3 py-0.5 font-mono text-[11px] leading-relaxed"
      role="log"
      aria-live="polite"
      title={`${entry.targetUrl ?? entry.tool} — ${relTime}`}
    >
      <span class="text-log-ts whitespace-nowrap" aria-label={ts}>{ts}</span>
      <span class="text-log-tool truncate">
        {entry.tool}
        <span class="text-log-text/60"> {target}</span>
      </span>
      <span class={`whitespace-nowrap ${status.color}`} aria-label={status.label}>
        <span aria-hidden="true">{status.icon}</span> {status.label}
        {duration && <span class="text-log-text/50"> · {duration}</span>}
        {entry.errorCode && <span class="text-red-300"> · {entry.errorCode}</span>}
      </span>
    </div>
  );
};
