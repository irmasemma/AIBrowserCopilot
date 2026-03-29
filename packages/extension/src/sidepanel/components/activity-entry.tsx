import type { FunctionalComponent } from 'preact';
import type { ActivityEntry as ActivityEntryType } from '../../shared/types.js';

interface ActivityEntryProps {
  entry: ActivityEntryType;
}

const TOOL_ICONS: Record<string, string> = {
  get_page_content: '📄',
  take_screenshot: '📸',
  list_tabs: '📋',
  get_page_metadata: '🔗',
  navigate: '🧭',
  fill_form: '✏️',
  click_element: '👆',
  extract_table: '📊',
};

const STATUS_DISPLAY: Record<string, { icon: string; color: string }> = {
  success: { icon: '✓', color: 'text-status-connected' },
  error: { icon: '✕', color: 'text-status-disconnected' },
  blocked: { icon: '🚫', color: 'text-status-disconnected' },
  'in-progress': { icon: '⏳', color: 'text-status-info' },
};

const truncateUrl = (url: string | null, maxLen = 30): string => {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname;
    return hostname.length > maxLen ? hostname.slice(0, maxLen) + '...' : hostname;
  } catch {
    return url.slice(0, maxLen);
  }
};

export const ActivityEntryComponent: FunctionalComponent<ActivityEntryProps> = ({ entry }) => {
  const toolIcon = TOOL_ICONS[entry.tool] ?? '🔧';
  const status = STATUS_DISPLAY[entry.status] ?? STATUS_DISPLAY.error;
  const duration = entry.duration !== null ? `${(entry.duration / 1000).toFixed(1)}s` : '';

  return (
    <div class="flex items-center gap-1 px-3 py-1 text-xs" role="log" aria-live="polite">
      <span aria-hidden="true">{toolIcon}</span>
      <span class="text-neutral-700 truncate flex-1">{truncateUrl(entry.targetUrl)}</span>
      <span class={status.color} aria-label={entry.status}>{status.icon}</span>
      {duration && <span class="text-neutral-400 w-8 text-right">{duration}</span>}
    </div>
  );
};
