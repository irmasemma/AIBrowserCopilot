import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { StatusBadge } from './status-badge.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { useStore } from '../store.js';

export const ConnectionHeader: FunctionalComponent = () => {
  const [showDiag, setShowDiag] = useState(false);
  const connectionContext = useStore((s) => s.connectionContext);
  const { state, serverInfo, reconnectsThisSession, failureCount } = connectionContext;

  const subtitleText = (): string | null => {
    if (state === 'connected' && serverInfo?.startedBy) {
      return `Connected to ${serverInfo.startedBy}`;
    }
    if (state === 'reconnecting') {
      return `Reconnecting (attempt ${failureCount})...`;
    }
    return null;
  };

  const subtitle = subtitleText();

  return (
    <header class="border-b border-neutral-200 bg-white" role="banner">
      <div class="flex items-center justify-between px-6 py-3">
        <button
          class="flex items-center gap-1 cursor-pointer hover:opacity-80"
          onClick={() => setShowDiag(!showDiag)}
          aria-label="Toggle connection diagnostics"
          title="Click for diagnostics"
        >
          <StatusBadge state={state} />
          <span class={`ml-1 text-xs transition-transform ${showDiag ? 'rotate-180' : ''}`} aria-hidden="true">▾</span>
        </button>
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
      </div>
      {subtitle && (
        <div class="px-6 pb-2">
          <span class="text-xs text-neutral-500">{subtitle}</span>
        </div>
      )}
      {showDiag && (
        <DiagnosticsPanel serverInfo={serverInfo} connectionContext={connectionContext} />
      )}
    </header>
  );
};
