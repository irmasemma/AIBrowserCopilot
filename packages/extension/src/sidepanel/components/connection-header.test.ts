import { describe, it, expect } from 'vitest';
import { deriveHeader } from './connection-header';
import type { DiagnosticReason } from '../../shared/types';
import type { ApiStateFacts } from '../connection-verdict';

const baseArgs = {
  displayState: 'reconnecting' as const,
  state: 'reconnecting',
  diagnosticReason: null as DiagnosticReason | null,
  failureCount: 1,
  lastConnectedAt: null,
  reconnectingSinceMs: 0,
  versionStatus: null as 'ok' | 'outdated' | null,
  startedBy: undefined as string | undefined,
};

const liveFacts: ApiStateFacts = {
  liveness: 'live',
  lastSeenAgeSec: 2,
  supersededCount: 0,
  supersededRecentCount: 0,
  lastRelayCloseCode: null,
  idempotentTieRecentCount: 0,
  hadRecentSuccess: false,
  hadRecentFailure: false,
  hadRecentReplacedMidRequest: false,
};

describe('deriveHeader — verdict adapter', () => {
  // ── The lie is dead: a freshly-connected session is NOT "Working" ──────────
  it('connected with NO tool-path fact → "Connected — not yet tested" (untested), Run a quick check', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connected', api: null });
    expect(h.title).toBe('Connected — not yet tested');
    expect(h.severity).toBe('warn');
    expect(h.badge).toBe('untested');
    expect(h.buttons[0]?.id).toBe('run_quick_check');
  });

  it('connected + a real recent request success → "Connected — tools working" (Working)', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, hadRecentSuccess: true },
    });
    expect(h.title).toBe('Connected — tools working');
    expect(h.severity).toBe('ok');
    expect(h.badge).toBe('working');
    expect(h.buttons).toHaveLength(0);
  });

  it('connected + liveness=live, no failures, flat supersede → Working', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connected', api: liveFacts });
    expect(h.title).toBe('Connected — tools working');
    expect(h.badge).toBe('working');
  });

  it('connected + quickCheckPassed (synthetic list_tabs) → Working without /api/state', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connected', api: null, quickCheckPassed: true });
    expect(h.title).toBe('Connected — tools working');
    expect(h.badge).toBe('working');
  });

  it('connected but a recent request FAILED → never Working (stays untested)', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, hadRecentSuccess: true, hadRecentFailure: true },
    });
    expect(h.title).toBe('Connected — not yet tested');
    expect(h.badge).toBe('untested');
  });

  // ── Flapping — bound to bridge supersede RATE, not reconnectsThisSession ────
  it('flapping from /api/state supersededRecentCount ≥ 3 → "Connection keeps dropping", re-run setup primary', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, supersededRecentCount: 4 },
    });
    expect(h.title).toBe('Connection keeps dropping');
    expect(h.severity).toBe('error');
    expect(h.badge).toBe('flapping');
    // Primary recovery is now re-running setup (npx re-registers the extension
    // with the bridge); restart bridge remains available as a secondary action.
    expect(h.buttons[0]?.id).toBe('copy_install_command');
    expect(h.buttons.map((b) => b.id)).toContain('restart_service');
  });

  it('flapping from a request failing with browser_socket_replaced_mid_request', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, hadRecentFailure: true, hadRecentReplacedMidRequest: true },
    });
    expect(h.title).toBe('Connection keeps dropping');
    expect(h.badge).toBe('flapping');
  });

  it('reconnectsThisSession is only a SECONDARY corroborator — used when /api/state is absent', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connected', api: null, reconnectsThisSession: 5 });
    expect(h.title).toBe('Connection keeps dropping');
    expect(h.badge).toBe('flapping');
  });

  it('bridge says flat supersede → reconnectsThisSession does NOT override it into flapping', () => {
    // /api/state present + healthy must win; a stale client counter cannot force flapping.
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, hadRecentSuccess: true },
      reconnectsThisSession: 9,
    });
    expect(h.title).toBe('Connected — tools working');
  });

  // ── Recovering — the 4002 dead-window must never read "Connected" ──────────
  it('awaiting_sw_recovery → "Reconnecting to your browser", Reconnect now, recovering badge', () => {
    const h = deriveHeader({ ...baseArgs, state: 'reconnecting', diagnosticReason: 'awaiting_sw_recovery' });
    expect(h.title).toBe('Reconnecting to your browser');
    expect(h.badge).toBe('recovering');
    expect(h.severity).toBe('warn');
    expect(h.buttons[0]?.id).toBe('reconnect_now');
    expect(h.buttons[0]?.label).toBe('Reconnect now');
  });

  it('awaiting_sw_recovery wins even if state is still connected (no lying green)', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      diagnosticReason: 'awaiting_sw_recovery',
      api: { ...liveFacts, hadRecentSuccess: true },
    });
    expect(h.title).toBe('Reconnecting to your browser');
    expect(h.badge).toBe('recovering');
  });

  // ── Stale from bridge truth ────────────────────────────────────────────────
  it('liveness=stale → "Connection went quiet", Reconnect', () => {
    const h = deriveHeader({
      ...baseArgs,
      state: 'connected',
      api: { ...liveFacts, liveness: 'stale', lastSeenAgeSec: 60 },
    });
    expect(h.title).toBe('Connection went quiet');
    expect(h.badge).toBe('stale');
    expect(h.buttons[0]?.id).toBe('reconnect_now');
  });

  // ── Named hard-failure states (unchanged behavior) ─────────────────────────
  it('no_lock_file shows Start AgentHub service button', () => {
    const h = deriveHeader({ ...baseArgs, state: 'disconnected', diagnosticReason: 'no_lock_file' });
    expect(h.title).toBe("Bridge isn't running");
    expect(h.severity).toBe('error');
    expect(h.buttons.some((b) => b.id === 'start_service')).toBe(true);
  });

  it('bridge_not_started shows Start AgentHub service button', () => {
    const h = deriveHeader({ ...baseArgs, state: 'disconnected', diagnosticReason: 'bridge_not_started' });
    expect(h.title).toBe("Bridge isn't running");
    expect(h.buttons.some((b) => b.id === 'start_service')).toBe(true);
  });

  it('helper_unavailable shows Copy install command + Reload', () => {
    const h = deriveHeader({ ...baseArgs, state: 'disconnected', diagnosticReason: 'helper_unavailable' });
    expect(h.title).toBe('Setup incomplete');
    expect(h.buttons.map((b) => b.id)).toContain('copy_install_command');
    expect(h.buttons.map((b) => b.id)).toContain('reload_extension');
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('protocol_timeout shows Restart service', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connecting', diagnosticReason: 'protocol_timeout' });
    expect(h.title).toBe('Bridge running but unresponsive');
    expect(h.buttons.map((b) => b.id)).toContain('restart_service');
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('server_not_responding shows Restart service', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connecting', diagnosticReason: 'server_not_responding' });
    expect(h.buttons.map((b) => b.id)).toContain('restart_service');
  });

  it('was_connected shows Reconnect now', () => {
    const h = deriveHeader({ ...baseArgs, state: 'reconnecting', diagnosticReason: 'was_connected' });
    expect(h.title).toBe('Lost connection');
    expect(h.buttons[0]?.id).toBe('reconnect_now');
  });

  it('reconnecting < 30s shows attempt count, no buttons', () => {
    const h = deriveHeader({ ...baseArgs, state: 'reconnecting', failureCount: 2, reconnectingSinceMs: 5000 });
    expect(h.title).toContain('attempt 2');
    expect(h.buttons).toHaveLength(0);
    expect(h.autoOpenDiagnostics).toBe(false);
  });

  it('reconnecting > 30s switches to "looks broken" with action buttons', () => {
    const h = deriveHeader({ ...baseArgs, state: 'reconnecting', failureCount: 6, reconnectingSinceMs: 35_000 });
    expect(h.title).toBe('Bridge looks broken');
    expect(h.severity).toBe('error');
    expect(h.buttons.length).toBeGreaterThan(0);
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('outdated version shows Copy update command', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connecting', versionStatus: 'outdated' });
    expect(h.title).toBe('Versions don’t match');
    expect(h.buttons[0]?.id).toBe('copy_install_command');
  });

  it('degraded state shows Restart + Reconnect', () => {
    const h = deriveHeader({ ...baseArgs, state: 'degraded', api: null });
    expect(h.severity).toBe('warn');
    expect(h.buttons.map((b) => b.id)).toEqual(expect.arrayContaining(['restart_service', 'reconnect_now']));
  });

  it('connecting (initial) is warn with no buttons', () => {
    const h = deriveHeader({ ...baseArgs, state: 'connecting' });
    expect(h.title).toBe('Looking for bridge…');
    expect(h.severity).toBe('warn');
    expect(h.buttons).toHaveLength(0);
  });
});
