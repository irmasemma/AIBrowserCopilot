import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { StatusBadge } from './status-badge.js';
import { DiagnosticsPanel } from './diagnostics-panel.js';
import { useStore } from '../store.js';
import { STALE_THRESHOLD_MS, type DiagnosticReason } from '../../shared/types.js';
import { useApiState } from '../use-api-state.js';
import { deriveVerdict, type ApiStateFacts, type Verdict, type VerdictAction } from '../connection-verdict.js';

type ActionButton = VerdictAction;

const INSTALL_COMMAND = 'npx agenthub-setup@latest --update';

/**
 * Thin adapter over the single shared verdict (`deriveVerdict`) so the header,
 * the diagnostics panel, and the dashboard all agree (design §4 / §7.2). Kept as
 * `deriveHeader` so existing tests/callers keep working; the new `api` /
 * `quickCheckPassed` facts are optional and default to "no extra facts" → it
 * behaves as the legacy client-only derivation when /api/state is unavailable.
 */
export interface DerivedHeader {
  /** The verdict kind — passed to DiagnosticsPanel so it knows whether a
   *  version-mismatch callout should be primary (kind==='version_mismatch') or
   *  demoted to a secondary note (another issue owns the headline). */
  kind: Verdict['kind'];
  title: string;
  subtitle: string | null;
  /** When true, the title row should be styled red (broken) instead of amber. */
  severity: 'ok' | 'warn' | 'error';
  buttons: ActionButton[];
  /** Auto-expand the diagnostics panel? Used when state has been broken too long. */
  autoOpenDiagnostics: boolean;
  /** Verdict badge state — drives the StatusBadge so it agrees with the title. */
  badge: Verdict['badge'];
}

export function deriveHeader(args: {
  displayState?: string;
  state: string;
  diagnosticReason: DiagnosticReason | null;
  failureCount: number;
  lastConnectedAt: number | null;
  reconnectingSinceMs: number | null;
  versionStatus: 'ok' | 'outdated' | null;
  startedBy?: string;
  reconnectsThisSession?: number;
  lastVerifiedAt?: number;
  api?: ApiStateFacts | null;
  quickCheckPassed?: boolean;
}): DerivedHeader {
  const verdict = deriveVerdict({
    ctx: {
      state: args.state as never,
      diagnosticReason: args.diagnosticReason,
      failureCount: args.failureCount,
      lastConnectedAt: args.lastConnectedAt,
      reconnectsThisSession: args.reconnectsThisSession ?? 0,
      lastVerifiedAt: args.lastVerifiedAt ?? 0,
      versionStatus: args.versionStatus,
    },
    api: args.api ?? null,
    quickCheckPassed: args.quickCheckPassed ?? false,
    reconnectingSinceMs: args.reconnectingSinceMs,
    staleThresholdMs: STALE_THRESHOLD_MS,
  });
  return {
    kind: verdict.kind,
    title: verdict.title,
    subtitle: verdict.subtitle,
    severity: verdict.severity,
    buttons: verdict.actions,
    autoOpenDiagnostics: verdict.autoOpenDiagnostics,
    badge: verdict.badge,
  };
}

export const ConnectionHeader: FunctionalComponent = () => {
  // Default to expanded for this release — user can still collapse manually.
  const [showDiag, setShowDiag] = useState(true);
  const [busyButton, setBusyButton] = useState<ActionButton['id'] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const connectionContext = useStore((s) => s.connectionContext);
  const { state, serverInfo, failureCount, diagnosticReason, lastConnectedAt, versionStatus, reconnectsThisSession, lastVerifiedAt } = connectionContext;

  // Consume /api/state for OUR browserId — the truthful backing the header used
  // to discard. `facts` carries liveness + supersededCount + recent request
  // success/failure; `quickCheckPassed` flips true after an on-demand list_tabs.
  const isHealthy = state === 'connected' || state === 'degraded';
  const { facts, runQuickCheck, quickCheckPassed } = useApiState(serverInfo?.port, isHealthy);

  // Tick once a second so the "Reconnecting (attempt N)…" / "looks broken" /
  // recovering labels become accurate without waiting for an external update.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
        state,
        diagnosticReason,
        failureCount,
        lastConnectedAt,
        reconnectingSinceMs,
        versionStatus,
        startedBy: serverInfo?.startedBy,
        reconnectsThisSession,
        lastVerifiedAt,
        api: facts,
        quickCheckPassed,
      }),
    [state, diagnosticReason, failureCount, lastConnectedAt, reconnectingSinceMs, versionStatus, serverInfo?.startedBy, reconnectsThisSession, lastVerifiedAt, facts, quickCheckPassed],
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
        case 'run_quick_check': {
          // Fire a REAL list_tabs through the MCP dispatch path. Success is the
          // tool-path fact that upgrades the headline to "Working" — never a pong.
          setFlash('Running a quick check…');
          const ok = await runQuickCheck();
          setFlash(ok ? 'Quick check passed — tools are working.' : 'Quick check failed — tools aren’t responding.');
          break;
        }
        case 'reload_extension':
          setFlash('Reloading extension…');
          setTimeout(() => chrome.runtime.reload(), 800);
          break;
        case 'copy_install_command': {
          // Include the live extension ID so re-running setup re-registers THIS
          // extension with the bridge (the fix for the "origin not in allowlist"
          // flapping loop — a bare update without the id can't add the origin).
          const extId = chrome.runtime?.id ?? '';
          const installCommand = extId
            ? `${INSTALL_COMMAND} --extension-id ${extId}`
            : INSTALL_COMMAND;
          try {
            await navigator.clipboard.writeText(installCommand);
            setFlash('Setup command copied — paste it into a terminal and run it');
          } catch {
            setFlash(`Copy failed — run: ${installCommand}`);
          }
          break;
        }
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
      {/* Polite live region: announces the HEADER TITLE transition
          (Working \u2192 Flapping \u2192 Recovering \u2192 \u2026) to screen readers. Previously
          only the badge dot announced; the title itself was a silent button
          (design \u00A77.2 / accessibility law). Visually hidden \u2014 the visible title
          below renders the same text. */}
      <span
        role="status"
        aria-live="polite"
        class="sr-only"
        data-testid="connection-header-live"
      >
        {`Connection status: ${header.title}`}
      </span>
      <div class="flex items-center justify-between px-4 py-3">
        <span class="text-base font-semibold text-neutral-900 tracking-tight">AgentHub</span>
        <button
          class="flex items-center gap-1.5 cursor-pointer hover:opacity-80"
          onClick={() => setShowDiag(!showDiag)}
          aria-label={`${header.title}. Toggle connection diagnostics`}
          aria-expanded={showDiag}
          title="Click for diagnostics"
        >
          <StatusBadge state={header.badge} compact />
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
        <DiagnosticsPanel
          serverInfo={serverInfo}
          connectionContext={connectionContext}
          verdictTitle={header.title}
          verdictSeverity={header.severity}
          verdictKind={header.kind}
          verdictActionIds={header.buttons.map((b) => b.id)}
        />
      )}
    </header>
  );
};
