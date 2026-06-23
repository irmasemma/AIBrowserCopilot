import { describe, it, expect, vi } from 'vitest';
import { createStartCoordinator, type CoordinatorAttempt } from './start-coordinator';

const ok = (overrides: Partial<CoordinatorAttempt> = {}): CoordinatorAttempt =>
  ({ ok: true, alreadyRunning: false, pid: 1234, ...overrides });
const fail = (msg = 'spawn_failed'): CoordinatorAttempt => ({ ok: false, error: msg });

describe('start-coordinator', () => {
  it('runs the attempt and reports success', async () => {
    const attempt = vi.fn().mockResolvedValue(ok());
    const c = createStartCoordinator({ attempt });
    const result = await c.tryStart();
    expect(result.ok).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(c.getState().consecutiveFailures).toBe(0);
  });

  it('deduplicates concurrent calls (single-flight)', async () => {
    let resolve: (v: CoordinatorAttempt) => void = () => undefined;
    const attempt = vi.fn(() => new Promise<CoordinatorAttempt>((r) => { resolve = r; }));
    const c = createStartCoordinator({ attempt });
    const p1 = c.tryStart();
    const p2 = c.tryStart();
    const p3 = c.tryStart();
    resolve(ok());
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('blocks repeat attempts within the cooldown window', async () => {
    let t = 1000;
    const attempt = vi.fn().mockResolvedValue(ok());
    const c = createStartCoordinator({ attempt, cooldownMs: 5000, now: () => t });
    await c.tryStart();
    t += 1000; // 1s later — still in cooldown
    const second = await c.tryStart();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(second.ok).toBe(true); // returns cached lastResult
  });

  it('allows new attempts once cooldown elapses', async () => {
    let t = 1000;
    const attempt = vi.fn().mockResolvedValue(ok());
    const c = createStartCoordinator({ attempt, cooldownMs: 5000, now: () => t });
    await c.tryStart();
    t += 6000;
    await c.tryStart();
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('user-initiated bypasses cooldown', async () => {
    let t = 1000;
    const attempt = vi.fn().mockResolvedValue(ok());
    const c = createStartCoordinator({ attempt, cooldownMs: 60_000, now: () => t });
    await c.tryStart();
    t += 1000;
    await c.tryStart({ userInitiated: true });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('auto-locks after maxAutoAttempts consecutive failures', async () => {
    let t = 0;
    const attempt = vi.fn().mockResolvedValue(fail());
    const c = createStartCoordinator({ attempt, cooldownMs: 0, maxAutoAttempts: 3, now: () => t });
    for (let i = 0; i < 3; i++) {
      t += 1; // bypass cooldown
      await c.tryStart();
    }
    expect(c.getState().autoLocked).toBe(true);

    t += 100;
    const blocked = await c.tryStart();
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('auto_restart_locked');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('user-initiated unlocks an auto-locked coordinator', async () => {
    let t = 0;
    const attempt = vi.fn().mockResolvedValue(fail());
    const c = createStartCoordinator({ attempt, cooldownMs: 0, maxAutoAttempts: 2, now: () => t });
    t += 1; await c.tryStart();
    t += 1; await c.tryStart();
    expect(c.getState().autoLocked).toBe(true);

    attempt.mockResolvedValue(ok());
    t += 1;
    const result = await c.tryStart({ userInitiated: true });
    expect(result.ok).toBe(true);
    expect(c.getState().autoLocked).toBe(false);
    expect(c.getState().consecutiveFailures).toBe(0);
  });

  it('successful attempt resets failure counter', async () => {
    let t = 0;
    const attempt = vi.fn()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(ok());
    const c = createStartCoordinator({ attempt, cooldownMs: 0, now: () => t });
    t += 1; await c.tryStart();
    t += 1; await c.tryStart();
    expect(c.getState().consecutiveFailures).toBe(2);
    t += 1; await c.tryStart();
    expect(c.getState().consecutiveFailures).toBe(0);
  });

  it('reset() clears all state', async () => {
    const attempt = vi.fn().mockResolvedValue(fail());
    const c = createStartCoordinator({ attempt, cooldownMs: 0 });
    await c.tryStart();
    c.reset();
    expect(c.getState()).toMatchObject({
      consecutiveFailures: 0,
      autoLocked: false,
      lastAttemptAt: null,
      lastResult: null,
    });
  });

  it('catches synchronous exceptions in the attempt and reports them as failure', async () => {
    const c = createStartCoordinator({
      attempt: () => { throw new Error('boom'); },
    });
    const result = await c.tryStart();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
    expect(c.getState().consecutiveFailures).toBe(1);
  });
});
