import { describe, it, expect } from 'vitest';
import { deriveHeader } from './connection-header';
import type { DiagnosticReason } from '../../shared/types';

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

describe('deriveHeader', () => {
  it('connected → ok severity, no buttons', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'connected', state: 'connected' });
    expect(h.severity).toBe('ok');
    expect(h.title).toBe('Connected');
    expect(h.buttons).toHaveLength(0);
  });

  it('connected with startedBy includes attribution', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'connected', state: 'connected', startedBy: 'vscode' });
    expect(h.subtitle).toContain('vscode');
  });

  it('no_lock_file shows Start Pilotwave service button', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'no_lock_file' });
    expect(h.title).toBe("Bridge isn't running");
    expect(h.severity).toBe('error');
    expect(h.buttons.some((b) => b.id === 'start_service')).toBe(true);
  });

  it('bridge_not_started shows Start Pilotwave service button', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'bridge_not_started' });
    expect(h.title).toBe("Bridge isn't running");
    expect(h.buttons.some((b) => b.id === 'start_service')).toBe(true);
  });

  it('helper_unavailable shows Re-run installer + Reload', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'helper_unavailable' });
    expect(h.title).toBe('Setup incomplete');
    expect(h.buttons.map((b) => b.id)).toContain('copy_install_command');
    expect(h.buttons.map((b) => b.id)).toContain('reload_extension');
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('protocol_timeout shows Restart service', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'protocol_timeout' });
    expect(h.title).toBe('Bridge running but unresponsive');
    expect(h.buttons.map((b) => b.id)).toContain('restart_service');
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('server_not_responding shows Restart service', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'server_not_responding' });
    expect(h.buttons.map((b) => b.id)).toContain('restart_service');
  });

  it('was_connected shows Reconnect now', () => {
    const h = deriveHeader({ ...baseArgs, diagnosticReason: 'was_connected' });
    expect(h.title).toBe('Lost connection');
    expect(h.buttons[0]?.id).toBe('reconnect_now');
  });

  it('reconnecting < 30s shows attempt count, no buttons', () => {
    const h = deriveHeader({ ...baseArgs, failureCount: 2, reconnectingSinceMs: 5000 });
    expect(h.title).toContain('attempt 2');
    expect(h.buttons).toHaveLength(0);
    expect(h.autoOpenDiagnostics).toBe(false);
  });

  it('reconnecting > 30s switches to "looks broken" with action buttons', () => {
    const h = deriveHeader({ ...baseArgs, failureCount: 6, reconnectingSinceMs: 35_000 });
    expect(h.title).toBe('Bridge looks broken');
    expect(h.severity).toBe('error');
    expect(h.buttons.length).toBeGreaterThan(0);
    expect(h.autoOpenDiagnostics).toBe(true);
  });

  it('outdated version shows Copy install command', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'connecting', state: 'connecting', versionStatus: 'outdated' });
    expect(h.title).toBe('Bridge is outdated');
    expect(h.buttons[0]?.id).toBe('copy_install_command');
  });

  it('stale state shows Check now action', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'stale', state: 'connected' });
    expect(h.title).toContain('Verifying');
    expect(h.buttons[0]?.id).toBe('reconnect_now');
  });

  it('degraded state shows Restart + Reconnect', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'degraded', state: 'degraded' });
    expect(h.severity).toBe('warn');
    expect(h.buttons.map((b) => b.id)).toEqual(expect.arrayContaining(['restart_service', 'reconnect_now']));
  });

  it('connecting (initial) is warn with no buttons', () => {
    const h = deriveHeader({ ...baseArgs, displayState: 'connecting', state: 'connecting' });
    expect(h.title).toBe('Looking for bridge…');
    expect(h.severity).toBe('warn');
    expect(h.buttons).toHaveLength(0);
  });
});
