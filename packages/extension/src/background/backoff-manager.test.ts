import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateBackoff, createBackoffTimer } from './backoff-manager';

describe('calculateBackoff', () => {
  it('returns ~1000ms for failureCount 0 (within jitter range 800-1200)', () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateBackoff(0);
      expect(delay).toBeGreaterThanOrEqual(800);
      expect(delay).toBeLessThanOrEqual(1200);
    }
  });

  it('returns ~1600ms for failureCount 1 (within jitter range)', () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateBackoff(1);
      expect(delay).toBeGreaterThanOrEqual(1280);
      expect(delay).toBeLessThanOrEqual(1920);
    }
  });

  it('returns ~2560ms for failureCount 2 (within jitter range)', () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateBackoff(2);
      expect(delay).toBeGreaterThanOrEqual(2048);
      expect(delay).toBeLessThanOrEqual(3072);
    }
  });

  it('never exceeds MAX_BACKOFF + jitter (36000ms)', () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateBackoff(100);
      expect(delay).toBeLessThanOrEqual(36000);
    }
  });

  it('returns a number (not NaN, not Infinity)', () => {
    for (let count = 0; count < 20; count++) {
      const delay = calculateBackoff(count);
      expect(Number.isFinite(delay)).toBe(true);
      expect(Number.isNaN(delay)).toBe(false);
    }
  });

  it('different calls with same failureCount may return different values (jitter)', () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(calculateBackoff(0));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('BackoffTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedule calls callback after delay', () => {
    const timer = createBackoffTimer();
    const callback = vi.fn();
    timer.schedule(0, callback);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancel prevents callback from firing', () => {
    const timer = createBackoffTimer();
    const callback = vi.fn();
    timer.schedule(0, callback);
    timer.cancel();
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('getNextDelay returns calculated delay', () => {
    const timer = createBackoffTimer();
    const delay = timer.getNextDelay(0);
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });

  it('schedule cancels previous timer', () => {
    const timer = createBackoffTimer();
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    timer.schedule(0, callback1);
    timer.schedule(0, callback2);
    vi.advanceTimersByTime(1200);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});
