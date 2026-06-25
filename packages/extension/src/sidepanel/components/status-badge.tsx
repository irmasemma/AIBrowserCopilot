import type { FunctionalComponent } from 'preact';
import type { DisplayState } from '../../shared/types.js';

interface StatusBadgeProps {
  state: DisplayState;
  compact?: boolean;
}

export interface StateConfig {
  colorClass: string;
  icon: string;
  label: string;
  pulse: boolean;
  badge: boolean;
}

// Every state carries a DISTINCT icon + label, so status is never conveyed by
// color alone (accessibility law). The icon glyph is rendered visibly (not just
// aria-hidden) for the verbose badge, and the label feeds the aria-label.
export const getStateConfig = (state: DisplayState): StateConfig => {
  switch (state) {
    case 'disconnected':
      return { colorClass: 'bg-neutral-400', icon: '○', label: 'Not Connected', pulse: false, badge: false };
    case 'connecting':
      return { colorClass: 'bg-amber-400', icon: '●', label: 'Connecting...', pulse: true, badge: false };
    case 'connected':
    case 'working':
      // "Working" is the ONLY green — and only the verdict (a real tool-path
      // fact) ever maps a connection to it.
      return { colorClass: 'bg-green-500', icon: '●', label: 'Tools working', pulse: false, badge: false };
    case 'untested':
      // Connected but unproven: amber question, NOT green. (no silent staleness)
      return { colorClass: 'bg-amber-400', icon: '?', label: 'Not yet tested', pulse: false, badge: true };
    case 'flapping':
      // Distinct ↻ icon — the relay keeps getting replaced.
      return { colorClass: 'bg-red-500', icon: '↻', label: 'Connection keeps dropping', pulse: true, badge: true };
    case 'recovering':
      // Distinct ◍ icon (NOT the green dot) — 4002 dead-window, self-healing.
      return { colorClass: 'bg-amber-400', icon: '◍', label: 'Reconnecting…', pulse: true, badge: false };
    case 'degraded':
      return { colorClass: 'bg-amber-400', icon: '!', label: 'Unstable', pulse: false, badge: true };
    case 'reconnecting':
      return { colorClass: 'bg-amber-400', icon: '●', label: 'Reconnecting...', pulse: true, badge: false };
    case 'stale':
      return { colorClass: 'bg-neutral-400', icon: '◌', label: 'Connection went quiet', pulse: true, badge: false };
    default:
      return { colorClass: 'bg-neutral-400', icon: '○', label: 'Unknown', pulse: false, badge: false };
  }
};

export const StatusBadge: FunctionalComponent<StatusBadgeProps> = ({ state, compact }) => {
  const { colorClass, icon, label, pulse, badge } = getStateConfig(state);
  const dotClasses = `w-2 h-2 rounded-full ${colorClass}${pulse ? ' animate-pulse' : ''}`;

  return (
    <div
      class="flex items-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={`Connection: ${label}`}
      data-testid="status-badge"
      data-state={state}
      data-label={label}
      data-icon={icon}
    >
      <span class="relative flex items-center">
        <span class={dotClasses} aria-hidden="true" />
        {badge && (
          // Distinct per-state glyph (?, ↻, !) so the indicator is never
          // color-alone — visible to sighted users; label drives the aria-label.
          <span class="absolute -top-1 -right-1.5 text-[9px] font-bold text-amber-600" aria-hidden="true">{icon}</span>
        )}
      </span>
      {!compact && <span class="text-sm text-neutral-700">{label}</span>}
    </div>
  );
};
