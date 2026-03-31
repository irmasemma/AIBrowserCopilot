import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn(async () => 42);
    const result = await withRetry(fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error(`fail-${attempt}`);
      return 'ok';
    });

    const result = await withRetry(fn, { baseDelayMs: 10, maxDelayMs: 50 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after all attempts exhausted', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails');
    });

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 }),
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry callback between attempts', async () => {
    let attempt = 0;
    const onRetry = vi.fn();
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error(`fail-${attempt}`);
      return 'ok';
    });

    await withRetry(fn, { baseDelayMs: 10, maxDelayMs: 50, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number));
  });

  it('respects maxAttempts=1 (no retries)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 10 }),
    ).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff with increasing delays', async () => {
    const delays: number[] = [];
    const onRetry = vi.fn((_attempt: number, _err: Error, delayMs: number) => {
      delays.push(delayMs);
    });

    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    await expect(
      withRetry(fn, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10000, onRetry }),
    ).rejects.toThrow();

    // 3 retries (attempt 1, 2, 3 fail; 3 onRetry calls)
    expect(delays).toHaveLength(3);
    // Delays should generally increase (allowing for jitter)
    // Base: 100, 200, 400 (with ±20% jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(80);   // 100 * 0.8
    expect(delays[0]).toBeLessThanOrEqual(120);     // 100 * 1.2
    expect(delays[1]).toBeGreaterThanOrEqual(160);  // 200 * 0.8
    expect(delays[1]).toBeLessThanOrEqual(240);     // 200 * 1.2
    expect(delays[2]).toBeGreaterThanOrEqual(320);  // 400 * 0.8
    expect(delays[2]).toBeLessThanOrEqual(480);     // 400 * 1.2
  });

  it('caps delay at maxDelayMs', async () => {
    const delays: number[] = [];
    const onRetry = vi.fn((_attempt: number, _err: Error, delayMs: number) => {
      delays.push(delayMs);
    });

    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 20, onRetry }),
    ).rejects.toThrow();

    // All delays should be capped at maxDelayMs + jitter (20 * 1.2 = 24)
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(24);
    }
  });

  it('wraps non-Error throws into Error', async () => {
    const fn = vi.fn(async () => {
      throw 'string error';
    });

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 10 }),
    ).rejects.toThrow('string error');
  });
});
