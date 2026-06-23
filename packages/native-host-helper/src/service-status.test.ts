import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBinaryPath, deriveReason } from './service-status.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBinaryPath — architecture resolution', () => {
  // We can't change the value `process.platform` returns at runtime in a
  // safe / portable way (it's a read-only property; assignment is a no-op
  // or throws on hardened Node). Instead these tests assert the *current*
  // host produces a path that matches its actual arch, which is enough to
  // verify the regression: an ARM64 helper that hardcodes x64 fails this
  // because process.arch is "arm64" but the path still ends in "x64.exe".
  it('contains the runtime arch in the filename', () => {
    const path = getBinaryPath();
    const expectedArch = process.arch === 'arm64' ? 'arm64' : 'x64';
    expect(path).toContain(expectedArch);
    // Must NOT contain the *opposite* arch slug — this is the regression
    // guard. Before the fix, Windows ARM64 returned a path ending in
    // "win-x64.exe" regardless of process.arch.
    const wrongArch = expectedArch === 'arm64' ? 'x64' : 'arm64';
    expect(path).not.toContain(`-${wrongArch}.exe`);
    expect(path).not.toContain(`-${wrongArch}\u0000`);
  });

  it('uses the AgentHub naming scheme (matches mcp-registrar)', () => {
    // mcp-registrar.ts produces `agenthub-<os>-<arch>(.exe)`; service-status
    // must agree or process-spawner will look for the bridge at one path
    // while mcp-registrar tells external MCP clients to launch it from
    // another.
    const path = getBinaryPath();
    expect(path).toContain('agenthub-');
  });

  it('Windows path ends in .exe', () => {
    if (process.platform !== 'win32') return; // Skip on non-Windows hosts.
    expect(getBinaryPath().endsWith('.exe')).toBe(true);
  });
});

describe('deriveReason', () => {
  // Sanity checks for the diagnostic chain — added alongside the ARM64 fix
  // because the helper's whole purpose is "tell the UI what's broken".
  const base = {
    lockFile: { exists: true, pid: 123, port: 7483 },
    pidAlive: true,
    portListening: true,
    wsHealthy: true,
  } as const;

  it('reports no_lock_file when lock missing', () => {
    expect(deriveReason({ ...base, lockFile: { exists: false } })).toBe('no_lock_file');
  });

  it('reports connecting when wsHealthy=true even if pidAlive disagreed (Windows kill 0 false-negative)', () => {
    // Regression for v0.5.10 bug: pkg-bundled helper's process.kill(pid, 0)
    // sometimes returns false on Windows even when the target IS alive
    // (cross-process-tree perm quirk). The side panel kept showing
    // "Bridge isn't running" while bridge was actually responding to MCP.
    // wsHealthy is ground truth — if it's true, the bridge is up.
    expect(deriveReason({ ...base, pidAlive: false, wsHealthy: true })).toBe('connecting');
  });

  it('reports bridge_not_started when PID dead (no port, no WS)', () => {
    expect(deriveReason({ ...base, pidAlive: false, portListening: false, wsHealthy: false })).toBe('bridge_not_started');
  });

  it('reports bridge_not_started when port silent (regardless of pidAlive)', () => {
    expect(deriveReason({ ...base, portListening: false, wsHealthy: false })).toBe('bridge_not_started');
  });

  it('reports protocol_timeout when WS handshake stalls', () => {
    expect(
      deriveReason({ ...base, wsHealthy: false, wsHealthyError: 'protocol_timeout' }),
    ).toBe('protocol_timeout');
  });

  it('reports server_not_responding for other WS errors', () => {
    expect(
      deriveReason({ ...base, wsHealthy: false, wsHealthyError: 'wrong_pid' }),
    ).toBe('server_not_responding');
  });

  it('reports connecting when everything is healthy', () => {
    expect(deriveReason(base)).toBe('connecting');
  });
});
