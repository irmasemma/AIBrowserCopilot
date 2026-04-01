import type { FunctionalComponent } from 'preact';
import type { ConnectionState } from '../../shared/types.js';

interface StatusBadgeProps {
  state: ConnectionState;
  compact?: boolean;
}

export interface StateConfig {
  colorClass: string;
  icon: string;
  label: string;
  pulse: boolean;
  badge: boolean;
}

export const getStateConfig = (state: ConnectionState): StateConfig => {
  switch (state) {
    case 'disconnected':
      return { colorClass: 'bg-neutral-400', icon: '○', label: 'Not Connected', pulse: false, badge: false };
    case 'connecting':
      return { colorClass: 'bg-amber-400', icon: '●', label: 'Connecting...', pulse: true, badge: false };
    case 'connected':
      return { colorClass: 'bg-green-500', icon: '●', label: 'Connected', pulse: false, badge: false };
    case 'degraded':
      return { colorClass: 'bg-amber-400', icon: '●', label: 'Unstable', pulse: false, badge: true };
    case 'reconnecting':
      return { colorClass: 'bg-amber-400', icon: '●', label: 'Reconnecting...', pulse: true, badge: false };
    default:
      return { colorClass: 'bg-neutral-400', icon: '○', label: 'Unknown', pulse: false, badge: false };
  }
};

export const StatusBadge: FunctionalComponent<StatusBadgeProps> = ({ state, compact }) => {
  const { colorClass, label, pulse, badge } = getStateConfig(state);
  const dotClasses = `w-2 h-2 rounded-full ${colorClass}${pulse ? ' animate-pulse' : ''}`;

  return (
    <div class="flex items-center gap-1.5" role="status" aria-live="polite" aria-label={`Connection: ${label}`}>
      <span class="relative flex items-center">
        <span class={dotClasses} aria-hidden="true" />
        {badge && (
          <span class="absolute -top-1 -right-1.5 text-[9px] font-bold text-amber-600" aria-hidden="true">!</span>
        )}
      </span>
      {!compact && <span class="text-sm text-neutral-700">{label}</span>}
    </div>
  );
};
