import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { StatusBadge } from './status-badge.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { useStore } from '../store.js';
import { getDisplayState, type DiagnosticReason } from '../../shared/types.js';

interface ActionButton {
  id: 'start_service' | 'restart_service' | 'reconnect_now' | 'reload_extension' | 'copy_install_command';
  label: string;
  variant: 'primary' | 'secondary';
}

const INSTALL_COMMAND = 'npx agenthub-setup@latest --update';

/**
 * Pure mapping from connection-context shape to a UI title + subtitle + buttons.
 * Centralised so tests can assert "this state shows that label and these buttons"
 * without rendering Preact.
 */
export interface DerivedHeader {
  title: string;
  subtitle: string | null;
  /** When true, the title row should be styled red (broken) instead of amber. */
  severity: 'ok' | 'warn' | 'error';
  buttons: ActionButton[];
  /** Auto-expand the diagnostics panel? Used when state has been broken too long. */
  autoOpenDiagnostics: boolean;
}

export function deriveHeader(args: {
  displayState: ReturnType<typeof getDisplayState>;
  state: string;
  diagnosticReason: DiagnosticReason | null;
  failureCount: number;
  lastConnectedAt: number | null;
  reconnectingSinceMs: number | null;
  versionStatus: 'ok' | 'outdated' | null;
  startedBy?: string;
}): DerivedHeader {
  const { displayState, state, diagnosticReason, failureCount, reconnectingSinceMs, versionStatus, startedBy } = args;

  if (displayState === 'connected') {
    return {
      title: 'Connected',
      subtitle: startedBy && startedBy !== 'unknown' ? `Bridge running — started by ${startedBy}` : 'Bridge running',
      severity: 'ok',
      buttons: [],
      autoOpenDiagnostics: false,
    };
  }

  if (displayState === 'stale') {
    return {
      title: 'Verifying connection…',
      subtitle: 'Checking that the bridge is still responsive.',
      severity: 'warn',
      buttons: [{ id: 'reconnect_now', label: 'Check now', variant: 'secondary' }],
      autoOpenDiagnostics: false,
    };
  }

  if (displayState === 'degraded') {
    return {
      title: 'Connection unstable',
      subtitle: 'Heartbeats are missing. Try restarting the service.',
      severity: 'warn',
      buttons: [
        { id: 'restart_service', label: 'Restart service', variant: 'primary' },
        { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
      ],
      autoOpenDiagnostics: false,
    };
  }

  if (versionStatus === 'outdated') {
    return {
      title: 'Bridge is outdated',
      subtitle: 'Re-run the installer to update.',
      severity: 'warn',
      buttons: [
        { id: 'copy_install_command', label: 'Copy install command', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: false,
    };
  }

  const reconnectingTooLong = (reconnectingSinceMs ?? 0) > 30_000;

  // No bridge running.
  if (diagnosticReason === 'no_lock_file' || diagnosticReason === 'bridge_not_started') {
    return {
      title: "Bridge isn't running",
      subtitle: diagnosticReason === 'no_lock_file'
        ? 'No AgentHub service was found. Start it to enable browser tools.'
        : 'A bridge is registered but not currently running.',
      severity: 'error',
      buttons: [
        { id: 'start_service', label: 'Start AgentHub service', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  // Setup not finished.
  if (diagnosticReason === 'helper_unavailable') {
    return {
      title: 'Setup incomplete',
      subtitle: 'The native messaging helper isn\u2019t registered. Re-run the installer.',
      severity: 'error',
      buttons: [
        { id: 'copy_install_command', label: 'Copy install command', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  // Bridge alive but not speaking the protocol — likely zombie or wrong version.
  if (diagnosticReason === 'server_not_responding' || diagnosticReason === 'protocol_timeout') {
    return {
      title: 'Bridge running but unresponsive',
      subtitle: diagnosticReason === 'protocol_timeout'
        ? 'The service accepted the connection but never spoke the protocol. Restart it.'
        : 'The service isn\u2019t answering. Restart to recover.',
      severity: 'error',
      buttons: [
        { id: 'restart_service', label: 'Restart service', variant: 'primary' },
        { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  if (diagnosticReason === 'was_connected') {
    return {
      title: 'Lost connection',
      subtitle: startedBy && startedBy !== 'unknown'
        ? `Reopen ${startedBy} to reconnect.`
        : 'Reopen your AI tool to reconnect.',
      severity: 'warn',
      buttons: [
        { id: 'reconnect_now', label: 'Reconnect now', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  if (state === 'reconnecting') {
    return {
      title: reconnectingTooLong ? 'Bridge looks broken' : `Reconnecting (attempt ${failureCount})…`,
      subtitle: reconnectingTooLong
        ? 'Reconnect attempts have been failing — open diagnostics for details.'
        : 'Trying to re-establish the connection.',
      severity: reconnectingTooLong ? 'error' : 'warn',
      buttons: reconnectingTooLong
        ? [
            { id: 'restart_service', label: 'Restart service', variant: 'primary' },
            { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
            { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
          ]
        : [],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  if (state === 'connecting') {
    return {
      title: 'Looking for bridge…',
      subtitle: 'Finding the running AgentHub service.',
      severity: 'warn',
      buttons: [],
      autoOpenDiagnostics: false,
    };
  }

  return {
    title: 'Not connected',
    subtitle: 'Start the AgentHub service to enable browser tools.',
    severity: 'error',
    buttons: [
      { id: 'start_service', label: 'Start AgentHub service', variant: 'primary' },
      { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
    ],
    autoOpenDiagnostics: false,
  };
}

export const ConnectionHeader: FunctionalComponent = () => {
  const [showDiag, setShowDiag] = useState(false);
  const [busyButton, setBusyButton] = useState<ActionButton['id'] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const connectionContext = useStore((s) => s.connectionContext);
  const { state, serverInfo, failureCount, diagnosticReason, lastConnectedAt, versionStatus } = connectionContext;
  const displayState = getDisplayState(connectionContext);

  // Tick once a second so the "Reconnecting (attempt N)…" / "looks broken"
  // labels become accurate without waiting for an external state update.
  useEffect(() => {
    if (state !== 'reconnecting' && state !== 'connecting') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  // Fire verify_connection on mount to wake SW and force reconciliation.
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => {});
  }, []);

  const reconnectingSinceMs = useMemo(() => {
    if (state !== 'reconnecting' && state !== 'connecting') return null;
    return lastConnectedAt ? now - lastConnectedAt : (failureCount > 0 ? failureCount * 5000 : 0);
  }, [state, lastConnectedAt, failureCount, now]);

  const header = useMemo(
    () =>
      deriveHeader({
        displayState,
        state,
        diagnosticReason,
        failureCount,
        lastConnectedAt,
        reconnectingSinceMs,
        versionStatus,
        startedBy: serverInfo?.startedBy,
      }),
    [displayState, state, diagnosticReason, failureCount, lastConnectedAt, reconnectingSinceMs, versionStatus, serverInfo?.startedBy],
  );

  // Auto-expand diagnostics if the derived state demands it.
  useEffect(() => {
    if (header.autoOpenDiagnostics) setShowDiag(true);
  }, [header.autoOpenDiagnostics]);

  const handleAction = async (button: ActionButton) => {
    if (busyButton) return;
    setBusyButton(button.id);
    setFlash(null);
    try {
      switch (button.id) {
        case 'start_service':
          await chrome.runtime.sendMessage({ type: 'start_service', userInitiated: true }).catch(() => null);
          setFlash('Starting AgentHub service…');
          break;
        case 'restart_service':
          await chrome.runtime.sendMessage({ type: 'restart_service', userInitiated: true }).catch(() => null);
          setFlash('Restarting service…');
          break;
        case 'reconnect_now':
          await chrome.runtime.sendMessage({ type: 'verify_connection' }).catch(() => null);
          setFlash('Checking connection…');
          break;
        case 'reload_extension':
          setFlash('Reloading extension…');
          setTimeout(() => chrome.runtime.reload(), 800);
          break;
        case 'copy_install_command':
          try {
            await navigator.clipboard.writeText(INSTALL_COMMAND);
            setFlash('Install command copied to clipboard');
          } catch {
            setFlash(`Copy failed — run: ${INSTALL_COMMAND}`);
          }
          break;
      }
    } finally {
      setTimeout(() => setBusyButton(null), 600);
      setTimeout(() => setFlash(null), 4000);
    }
  };

  const titleColor =
    header.severity === 'error' ? 'text-red-600'
    : header.severity === 'warn' ? 'text-amber-700'
    : 'text-neutral-900';

  const statusLabel =
    header.severity === 'ok' ? 'text-status-connected'
    : header.severity === 'warn' ? 'text-amber-700'
    : 'text-red-600';

  return (
    <header class="border-b border-card-border bg-white" role="banner" data-testid="connection-header">
      <div class="flex items-center justify-between px-4 py-3">
        <span class="text-base font-semibold text-neutral-900 tracking-tight">AgentHub</span>
        <button
          class="flex items-center gap-1.5 cursor-pointer hover:opacity-80"
          onClick={() => setShowDiag(!showDiag)}
          aria-label="Toggle connection diagnostics"
          aria-expanded={showDiag}
          title="Click for diagnostics"
        >
          <StatusBadge state={displayState} compact />
          <span
            class={`text-xs font-medium ${header.severity === 'ok' ? statusLabel : titleColor}`}
            data-testid="connection-header-title"
          >
            {header.title}
          </span>
          <span class={`text-[10px] text-neutral-400 transition-transform ${showDiag ? 'rotate-180' : ''}`} aria-hidden="true">{'\u25BE'}</span>
        </button>
      </div>
      {header.subtitle && (
        <div class="px-4 pb-2">
          <p
            class="text-xs text-neutral-500 leading-snug"
            data-testid="connection-header-subtitle"
          >
            {header.subtitle}
          </p>
        </div>
      )}
      {header.buttons.length > 0 && (
        <div class="px-4 pb-3 flex flex-wrap gap-2">
          {header.buttons.map((btn) => (
            <button
              key={btn.id}
              class={
                btn.variant === 'primary'
                  ? 'text-xs font-medium px-3 py-1.5 rounded bg-brand-primary text-white hover:bg-brand-primary-dark disabled:opacity-50'
                  : 'text-xs font-medium px-3 py-1.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50'
              }
              onClick={() => void handleAction(btn)}
              disabled={busyButton !== null}
            >
              {busyButton === btn.id ? 'Working…' : btn.label}
            </button>
          ))}
        </div>
      )}
      {flash && (
        <div class="px-4 pb-2">
          <p class="text-xs text-neutral-600">{flash}</p>
        </div>
      )}
      {showDiag && (
        <DiagnosticsPanel serverInfo={serverInfo} connectionContext={connectionContext} />
      )}
    </header>
  );
};
