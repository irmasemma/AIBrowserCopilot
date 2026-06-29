/**
 * Tests for killIncumbentBridge.
 *
 * Required cases from spec:
 *   (a) Incumbent alive → killed, port goes free, spawn proceeds.
 *   (b) No lock file → no kill attempted, portFree true (cold restart works).
 *   (c) Lock pid already dead → no kill call, still proceeds.
 *   (d) Port still busy after pid kill → image-name escalation fires.
 *   (e) Helper's OWN image is never targeted by escalation.
 *   (f) Kill routine failure is surfaced in warnings but does not crash helper.
 *
 * All tests use injectable seams — no real processes or ports are touched.
 *
 * Note on vi.fn() casts: vitest 4 changed Mock generic syntax.  We assign
 * mock functions to the KillSeams interface using `as unknown as FnType`
 * rather than parametrized vi.fn<>() generics to stay compatible with both
 * vitest 4 and strict TypeScript.  Assertions are made on the vi.fn()
 * variable directly (not through the seam), so type narrowing is preserved
 * where it matters.
 */

import { describe, it, expect, vi } from 'vitest';
import { killIncumbentBridge } from './bridge-killer.js';
import { getBinaryPath } from './service-status.js';
import type { KillSeams } from './bridge-killer.js';

// Helper: cast vi.fn() to the correct seam function type.
// vitest 4 Mock<unknown> is not directly assignable to typed fn signatures.
function asKillPid(m: ReturnType<typeof vi.fn>): (pid: number) => Promise<void> {
  return m as unknown as (pid: number) => Promise<void>;
}
function asKillByName(m: ReturnType<typeof vi.fn>): (name: string) => Promise<void> {
  return m as unknown as (name: string) => Promise<void>;
}
function asProbePort(m: ReturnType<typeof vi.fn>): (port: number) => Promise<boolean> {
  return m as unknown as (port: number) => Promise<boolean>;
}

// Fast seams shared across tests: instant polls, short deadline.
const FAST: Partial<KillSeams> = {
  pollIntervalMs: 0,
  portWaitTimeoutMs: 20,
};

// ─── Case (b): No lock file ────────────────────────────────────────────────

describe('(b) no lock file → no kill, portFree = true', () => {
  it('returns attempted=false when lock file is absent', async () => {
    const killPid = vi.fn();
    const killByImageName = vi.fn();

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: false }),
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(killByImageName),
    });

    expect(result.attempted).toBe(false);
    expect(result.portFree).toBe(true);
    expect(result.escalated).toBe(false);
    expect(killPid).not.toHaveBeenCalled();
    expect(killByImageName).not.toHaveBeenCalled();
  });

  it('returns attempted=false when lock file exists but has no pid', async () => {
    const killPid = vi.fn();

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true }), // no pid field
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(result.attempted).toBe(false);
    expect(killPid).not.toHaveBeenCalled();
  });
});

// ─── Case (a): Incumbent alive → killed, port goes free ───────────────────

describe('(a) alive pid → killed, port free, no escalation', () => {
  it('kills the pid and returns portFree=true without escalating', async () => {
    const killPid = vi.fn().mockResolvedValue(undefined);
    const killByImageName = vi.fn();

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(false)), // port free immediately
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(killByImageName),
    });

    expect(result.attempted).toBe(true);
    expect(result.pid).toBe(1234);
    expect(result.port).toBe(7483);
    expect(result.portFree).toBe(true);
    expect(result.escalated).toBe(false);
    expect(killPid).toHaveBeenCalledOnce();
    expect(killPid).toHaveBeenCalledWith(1234);
    expect(killByImageName).not.toHaveBeenCalled();
  });

  it('uses lock file port when present (not hardcoded 7483)', async () => {
    const probePort = vi.fn().mockResolvedValue(false);

    await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 999, port: 8080 }),
      isPidAlive: () => true,
      probePort: asProbePort(probePort),
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(probePort).toHaveBeenCalledWith(8080);
  });

  it('falls back to port 7483 when lock file has no port', async () => {
    const probePort = vi.fn().mockResolvedValue(false);

    await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 999 }), // no port
      isPidAlive: () => true,
      probePort: asProbePort(probePort),
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(probePort).toHaveBeenCalledWith(7483);
  });
});

// ─── Case (c): Lock pid already dead ──────────────────────────────────────

describe('(c) pid already dead → no kill call, proceeds cleanly', () => {
  it('skips killPid when isPidAlive returns false', async () => {
    const killPid = vi.fn();

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 9999, port: 7483 }),
      isPidAlive: () => false, // already dead
      probePort: asProbePort(vi.fn().mockResolvedValue(false)), // port also free
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(result.attempted).toBe(true);
    expect(result.portFree).toBe(true);
    expect(result.escalated).toBe(false);
    expect(killPid).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── Case (d): Port still busy → image-name escalation ────────────────────

describe('(d) port still busy after pid kill → escalates to image-name kill', () => {
  it('calls killByImageName with the bridge image when port stays busy', async () => {
    const killPid = vi.fn().mockResolvedValue(undefined);
    const killByImageName = vi.fn();

    // Port is busy until escalation fires; then becomes free.
    let escalationDone = false;
    killByImageName.mockImplementation(async () => {
      escalationDone = true;
    });
    const probePort = vi.fn().mockImplementation(async () => !escalationDone);

    const result = await killIncumbentBridge({
      pollIntervalMs: 0,
      portWaitTimeoutMs: 30,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(probePort),
      getBinaryPath: () => '/usr/local/bin/agenthub-linux-x64',
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(killByImageName),
    });

    expect(result.escalated).toBe(true);
    expect(killByImageName).toHaveBeenCalledOnce();
    expect(killByImageName).toHaveBeenCalledWith('agenthub-linux-x64');
    expect(result.portFree).toBe(true);
  });

  it('reports portFree=false when port stays busy even after escalation', async () => {
    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(true)), // always busy
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(vi.fn().mockResolvedValue(undefined)),
    });

    expect(result.escalated).toBe(true);
    expect(result.portFree).toBe(false);
  });

  it('uses basename of getBinaryPath as the image name', async () => {
    const killByImageName = vi.fn();
    let escalationDone = false;
    killByImageName.mockImplementation(async () => { escalationDone = true; });
    const probePort = vi.fn().mockImplementation(async () => !escalationDone);

    await killIncumbentBridge({
      pollIntervalMs: 0,
      portWaitTimeoutMs: 30,
      readLockFile: () => ({ exists: true, pid: 1, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(probePort),
      getBinaryPath: () => 'C:\\Program Files\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(killByImageName),
    });

    // basename strips directory — only the filename is passed
    expect(killByImageName).toHaveBeenCalledWith('agenthub-win-x64.exe');
  });
});

// ─── Case (e): Helper's own image is NEVER targeted ───────────────────────

describe("(e) helper's own image is never targeted by escalation", () => {
  it('skips killByImageName and warns when image contains "-helper-"', async () => {
    const killByImageName = vi.fn();

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(true)), // port stays busy → triggers escalation check
      getBinaryPath: () => 'C:\\agenthub\\agenthub-helper-win-x64.exe', // helper path!
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(killByImageName),
    });

    expect(killByImageName).not.toHaveBeenCalled();
    expect(result.escalated).toBe(false);
    expect(result.warnings.some((w) => w.includes('-helper-'))).toBe(true);
  });

  it('real getBinaryPath() never returns a helper-looking path (invariant)', () => {
    // getBinaryPath() in service-status.ts points to the BRIDGE binary.
    // If it ever returns a path containing '-helper-', the safety guard
    // would suppress escalation and bridge zombies could never be cleaned up.
    const bridgePath = getBinaryPath();
    expect(bridgePath).not.toContain('-helper-');
  });
});

// ─── Case (f): Kill failure surfaced, no crash ────────────────────────────

describe('(f) kill failure surfaced in warnings, helper does not crash', () => {
  it('captures non-ESRCH kill errors in warnings and continues', async () => {
    const killPid = vi.fn().mockRejectedValue(new Error('Access denied'));

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(false)), // port free after failed kill
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(result.warnings.some((w) => w.includes('Access denied'))).toBe(true);
    expect(result.portFree).toBe(true);
    expect(result.attempted).toBe(true);
    // No throw — function returned normally
  });

  it('treats ESRCH as "already gone" — no warning emitted', async () => {
    const killPid = vi.fn().mockRejectedValue(new Error('ESRCH: No such process'));

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(false)),
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.portFree).toBe(true);
  });

  it('treats Windows "could not be found" as already-gone — no warning', async () => {
    const killPid = vi.fn().mockRejectedValue(
      new Error('The process with PID 1234 could not be found.'),
    );

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(false)),
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(killPid),
      killByImageName: asKillByName(vi.fn()),
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('captures image-name kill failures in warnings without re-throwing', async () => {
    const killByImageName = vi.fn().mockRejectedValue(new Error('permission denied'));

    const result = await killIncumbentBridge({
      ...FAST,
      readLockFile: () => ({ exists: true, pid: 1234, port: 7483 }),
      isPidAlive: () => true,
      probePort: asProbePort(vi.fn().mockResolvedValue(true)), // port stays busy throughout
      getBinaryPath: () => 'C:\\agenthub\\agenthub-win-x64.exe',
      killPid: asKillPid(vi.fn().mockResolvedValue(undefined)),
      killByImageName: asKillByName(killByImageName),
    });

    expect(result.escalated).toBe(true);
    expect(result.warnings.some((w) => w.includes('permission denied'))).toBe(true);
    expect(result.portFree).toBe(false);
    // No crash — function returned normally
  });
});
