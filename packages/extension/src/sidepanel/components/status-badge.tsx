import type { FunctionalComponent } from 'preact';
import type { ConnectionState } from '../../shared/types.js';

interface StatusBadgeProps {
  state: ConnectionState;
  compact?: boolean;
}

const config: Record<ConnectionState, { color: string; icon: string; label: string }> = {
  connected: { color: 'bg-status-connected', icon: '●', label: 'Connected' },
  disconnected: { color: 'bg-status-disconnected', icon: '●', label: 'Disconnected' },
  reconnecting: { color: 'bg-status-warning animate-pulse', icon: '●', label: 'Reconnecting...' },
  'setup-needed': { color: 'bg-neutral-400', icon: '○', label: 'Setup Required' },
};

export const StatusBadge: FunctionalComponent<StatusBadgeProps> = ({ state, compact }) => {
  const { color, icon, label } = config[state];
  return (
    <div class="flex items-center gap-1" role="status" aria-live="polite" aria-label={`Connection: ${label}`}>
      <span class={`w-2 h-2 rounded-full ${color}`} aria-hidden="true">{icon === '○' ? '' : ''}</span>
      {!compact && <span class="text-sm text-neutral-700">{label}</span>}
    </div>
  );
};
