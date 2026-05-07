import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';
import { useEffect } from 'preact/hooks';
import { StatusBadge } from './status-badge.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { useStore } from '../store.js';
import { getDisplayState, isOutdatedNativeHostVersion, MIN_NATIVE_HOST_VERSION } from '../../shared/types.js';

export const ConnectionHeader: FunctionalComponent = () => {
  const [showDiag, setShowDiag] = useState(false);
  const connectionContext = useStore((s) => s.connectionContext);
  const { state, serverInfo, failureCount, diagnosticReason } = connectionContext;
  const displayState = getDisplayState(connectionContext);

  // AD-14: Send verify_connection on mount to wake SW and force reconciliation
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => {
      // SW may not be ready — alarm will handle it
    });
  }, []);

  const subtitleText = (): string | null => {
    if (displayState === 'stale') {
      // Defensive: lastVerifiedAt === 0 should be ruled out by getDisplayState, but if
      // it slips through (e.g. mid-state-transition), don't render "29 million minutes ago".
      if (!connectionContext.lastVerifiedAt) return 'Verifying...';
      const age = Date.now() - connectionContext.lastVerifiedAt;
      const ago = age < 60_000
        ? `${Math.round(age / 1000)}s ago`
        : `${Math.round(age / 60_000)}m ago`;
      return `Last confirmed ${ago}`;
    }
    if (displayState === 'connected' && serverInfo?.startedBy && serverInfo.startedBy !== 'unknown') {
      return `Connected via ${serverInfo.startedBy}`;
    }
    if (state === 'reconnecting') {
      return `Reconnecting (attempt ${failureCount})...`;
    }
    return null;
  };

  const guidanceText = (): string | null => {
    if (displayState === 'stale') return null; // Stale has its own UI with Check Now button
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

  const handleCheckNow = () => {
    chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => {});
  };

  const subtitle = subtitleText();
  const guidance = guidanceText();
  const outdatedHost = displayState === 'connected' && isOutdatedNativeHostVersion(serverInfo?.version);

  return (
    <header class="border-b border-neutral-200 bg-white" role="banner">
      {outdatedHost && (
        <div
          role="alert"
          aria-label="Update needed"
          class="bg-amber-50 border-b border-amber-200 px-6 py-3 text-xs"
          data-testid="outdated-native-host-banner"
        >
          <p class="font-semibold text-amber-900 mb-1">Update needed</p>
          <p class="text-amber-800 mb-2">
            Your AI Browser CoPilot bridge is on version {serverInfo?.version ?? 'unknown'} but
            the extension expects {MIN_NATIVE_HOST_VERSION} or newer. Re-run the installer to upgrade.
          </p>
          <p class="text-amber-800">
            <span class="font-medium">Run in your terminal:</span>{' '}
            <code class="bg-amber-100 px-1 py-0.5 rounded font-mono">npx ai-browser-copilot-setup --yes</code>
          </p>
        </div>
      )}
      <div class="flex items-center justify-between px-6 py-3">
        <button
          class="flex items-center gap-1 cursor-pointer hover:opacity-80"
          onClick={() => setShowDiag(!showDiag)}
          aria-label="Toggle connection diagnostics"
          title="Click for diagnostics"
        >
          <StatusBadge state={displayState} />
          <span class={`ml-1 text-xs transition-transform ${showDiag ? 'rotate-180' : ''}`} aria-hidden="true">{'\u25BE'}</span>
        </button>
        <span class="text-lg font-semibold text-neutral-900">CoPilot</span>
        <button
          class="text-neutral-400 hover:text-neutral-600"
          aria-label="Settings"
          onClick={() => {
            document.getElementById('support-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          {'\u2699\uFE0F'}
        </button>
      </div>
      {subtitle && (
        <div class="px-6 pb-2">
          <span class="text-xs text-neutral-500">{subtitle}</span>
        </div>
      )}
      {displayState === 'stale' && (
        <div class="px-6 pb-2">
          <button
            class="text-xs text-blue-600 hover:text-blue-800 underline cursor-pointer"
            onClick={handleCheckNow}
          >
            Check Now
          </button>
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
