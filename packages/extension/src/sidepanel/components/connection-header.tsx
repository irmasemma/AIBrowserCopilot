import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { StatusBadge } from './status-badge.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { useStore } from '../store.js';

export const ConnectionHeader: FunctionalComponent = () => {
  const [showDiag, setShowDiag] = useState(false);
  const connectionContext = useStore((s) => s.connectionContext);
  const { state, serverInfo, failureCount, diagnosticReason } = connectionContext;

  const subtitleText = (): string | null => {
    if (state === 'connected' && serverInfo?.startedBy && serverInfo.startedBy !== 'unknown') {
      return `Connected via ${serverInfo.startedBy}`;
    }
    if (state === 'reconnecting') {
      return `Reconnecting (attempt ${failureCount})...`;
    }
    return null;
  };

  const guidanceText = (): string | null => {
    if (state !== 'reconnecting' && state !== 'disconnected') return null;
    switch (diagnosticReason) {
      case 'was_connected': {
        const tool = serverInfo?.startedBy;
        return tool && tool !== 'unknown'
          ? `Lost connection to ${tool}. Reopen it to reconnect.`
          : 'Lost connection. Reopen your AI tool to reconnect.';
      }
      case 'no_lock_file':
        return 'No AI tool is running. Open Claude Code, VS Code, or Cursor.';
      case 'helper_unavailable':
        return 'Setup incomplete \u2014 run the installer to finish setup.';
      case 'server_not_responding':
        return `Server on port ${serverInfo?.port ?? 7483} isn\u2019t responding. Restart your AI tool.`;
      default:
        return 'Looking for AI tool...';
    }
  };

  const subtitle = subtitleText();
  const guidance = guidanceText();

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
      {guidance && (
        <div class="px-6 pb-2">
          <p class="text-xs text-neutral-500">{guidance}</p>
        </div>
      )}
      {showDiag && (
        <DiagnosticsPanel serverInfo={serverInfo} connectionContext={connectionContext} />
      )}
    </header>
  );
};
