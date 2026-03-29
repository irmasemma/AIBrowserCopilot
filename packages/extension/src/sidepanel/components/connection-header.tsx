import type { FunctionalComponent } from 'preact';
import { StatusBadge } from './status-badge.js';
import type { ConnectionState } from '../../shared/types.js';

interface ConnectionHeaderProps {
  state: ConnectionState;
}

export const ConnectionHeader: FunctionalComponent<ConnectionHeaderProps> = ({ state }) => {
  return (
    <header class="flex items-center justify-between px-6 py-3 border-b border-neutral-200 bg-white" role="banner">
      <StatusBadge state={state} />
      <span class="text-lg font-semibold text-neutral-900">CoPilot</span>
      <button
        class="text-neutral-400 hover:text-neutral-600"
        aria-label="Settings"
        onClick={() => {
          document.getElementById('support-section')?.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        ⚙️
      </button>
    </header>
  );
};
