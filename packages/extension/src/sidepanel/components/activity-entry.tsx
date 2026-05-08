import type { FunctionalComponent } from 'preact';
import type { ActivityEntry as ActivityEntryType } from '../../shared/types.js';

interface ActivityEntryProps {
  entry: ActivityEntryType;
}

interface ToolUiInfo {
  icon: string;
  /** Past-tense action label, e.g. "Read page", "Captured screenshot". */
  label: string;
}

const TOOL_INFO: Record<string, ToolUiInfo> = {
  get_page_content: { icon: '📄', label: 'Read page' },
  take_screenshot: { icon: '📸', label: 'Took screenshot' },
  list_tabs: { icon: '📋', label: 'Listed tabs' },
  get_page_metadata: { icon: '🔗', label: 'Read metadata' },
  navigate: { icon: '🧭', label: 'Navigated to' },
  fill_form: { icon: '✏️', label: 'Filled form on' },
  click_element: { icon: '👆', label: 'Clicked element on' },
  press_key: { icon: '⌨️', label: 'Pressed key on' },
  extract_table: { icon: '📊', label: 'Extracted table from' },
  read_form: { icon: '📝', label: 'Read form on' },
  extract_data: { icon: '🔍', label: 'Extracted data from' },
};

interface StatusUi {
  icon: string;
  color: string;
  bg: string;
  label: string;
}

const STATUS_DISPLAY: Record<string, StatusUi> = {
  success:       { icon: '✓', color: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Success' },
  error:         { icon: '✕', color: 'text-red-700',     bg: 'bg-red-50',     label: 'Error' },
  blocked:       { icon: '🚫', color: 'text-red-700',    bg: 'bg-red-50',     label: 'Blocked' },
  'in-progress': { icon: '⏳', color: 'text-amber-700',   bg: 'bg-amber-50',   label: 'Running' },
};

const formatHostname = (url: string | null, maxLen = 32): string => {
  if (!url) return 'browser';
  try {
    const hostname = new URL(url).hostname;
    return hostname.length > maxLen ? hostname.slice(0, maxLen) + '…' : hostname;
  } catch {
    return url.slice(0, maxLen);
  }
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
  const tool = TOOL_INFO[entry.tool] ?? { icon: '🔧', label: entry.tool };
  const status = STATUS_DISPLAY[entry.status] ?? STATUS_DISPLAY.error;
  const duration = formatDuration(entry.duration);
  const target = formatHostname(entry.targetUrl);
  const time = formatRelativeTime(entry.timestamp);

  return (
    <div
      class="flex items-start gap-2 px-4 py-2 text-xs"
      role="log"
      aria-live="polite"
      title={entry.targetUrl ?? undefined}
    >
      <span aria-hidden="true" class="text-base leading-tight flex-shrink-0">{tool.icon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-1.5">
          <span class="text-neutral-800 font-medium truncate">{tool.label}</span>
          <span class="text-neutral-600 truncate">{target}</span>
        </div>
        <div class="flex items-center gap-2 mt-0.5">
          <span
            class={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${status.color} ${status.bg}`}
            aria-label={status.label}
          >
            <span aria-hidden="true">{status.icon}</span>
            <span>{status.label}</span>
          </span>
          {entry.errorCode && (
            <span class="text-[10px] font-mono text-red-600 truncate" title={entry.errorCode}>
              {entry.errorCode}
            </span>
          )}
          <span class="text-[10px] text-neutral-400 ml-auto whitespace-nowrap">
            {duration && <>{duration} · </>}{time}
          </span>
        </div>
      </div>
    </div>
  );
};
