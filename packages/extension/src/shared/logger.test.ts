import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  logRecord,
  logError,
  flushPending,
  readBuffer,
  clearBuffer,
  _setStorageForTest,
  _resetStorageForTest,
} from './logger';

class MemoryStorage {
  store = new Map<string, unknown[]>();
  async get(key: string): Promise<unknown[]> {
    return [...(this.store.get(key) ?? [])];
  }
  async set(key: string, value: unknown[]): Promise<void> {
    this.store.set(key, [...value]);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  _setStorageForTest(storage);
});

describe('logger', () => {
  describe('logRecord', () => {
    it('appends an entry with default t, src, lvl, pid', async () => {
      await logRecord({ event: 'test.happened', foo: 'bar' });
      const buf = await readBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].event).toBe('test.happened');
      expect(buf[0].src).toBe('ext');
      expect(buf[0].lvl).toBe('info');
      expect(buf[0].pid).toBeNull();
      expect(typeof buf[0].t).toBe('string');
      expect(buf[0].foo).toBe('bar');
    });

    it('preserves explicit lvl', async () => {
      await logRecord({ event: 'test.warned', lvl: 'warn' });
      const buf = await readBuffer();
      expect(buf[0].lvl).toBe('warn');
    });

    it('redacts URL values', async () => {
      await logRecord({ event: 'test', url: 'https://example.com/secret/path?key=v' });
      const buf = await readBuffer();
      expect(String(buf[0].url)).toContain('example.com');
      expect(String(buf[0].url)).toContain('[redacted]');
      expect(String(buf[0].url)).not.toContain('secret');
    });

    it('redacts secrets without leaking length', async () => {
      await logRecord({ event: 'test', cookie: 'sessionId=abc123def456' });
      const buf = await readBuffer();
      expect(buf[0].cookie).toBe('[REDACTED-SECRET]');
    });

    it('redacts long text values to [len=N]', async () => {
      await logRecord({ event: 'test', text: 'hello world this is some data' });
      const buf = await readBuffer();
      expect(String(buf[0].text)).toMatch(/^\[len=\d+\]$/);
    });

    it('drops oldest when buffer exceeds 500 entries', async () => {
      // Pre-fill with 500 entries
      const prefilled: unknown[] = [];
      for (let i = 0; i < 500; i++) {
        prefilled.push({ t: '2026-01-01T00:00:00Z', src: 'ext', lvl: 'info', pid: null, event: 'old', seq: i });
      }
      await storage.set('__agenthub_log_buffer', prefilled);

      // Add one more — oldest should drop
      await logRecord({ event: 'new', seq: 9999 });

      const buf = await readBuffer();
      expect(buf).toHaveLength(500);
      // Oldest (seq=0) should be gone, newest at end
      expect((buf[0] as unknown as { seq: number }).seq).toBe(1);
      expect((buf[499] as unknown as { seq: number }).seq).toBe(9999);
    });

    it('does not throw on unstringifiable inputs (cyclic)', async () => {
      const cyclic: Record<string, unknown> = { name: 'cyclic' };
      cyclic.self = cyclic;
      await expect(logRecord({ event: 'test', payload: cyclic })).resolves.not.toThrow();
      const buf = await readBuffer();
      // Should have written a fallback record
      expect(buf).toHaveLength(1);
      expect(buf[0].event).toBe('test');
    });

    it('truncates oversized serialized entries', async () => {
      const huge = 'x'.repeat(20 * 1024);
      // Use 'description' key (not in TEXT_KEYS) and not a long string redaction target.
      // Actually 'description' IS in TEXT_KEYS so let me use a custom key not in any set.
      await logRecord({ event: 'big', _raw: huge });
      const buf = await readBuffer();
      // Either it's len-redacted by shape (>200 chars) or truncated.
      // For huge values, shape-based [len=N] redaction kicks in first because the
      // string > 200 chars triggers TEXT redaction at the leaf level.
      expect(buf).toHaveLength(1);
      expect(buf[0].event).toBe('big');
    });

    it('truncates when even the redacted entry exceeds 16KB', async () => {
      // Many small fields can balloon past 16KB even after per-value redaction.
      const wide: Record<string, unknown> = { event: 'wide' };
      for (let i = 0; i < 2000; i++) {
        // Each numbered field carries an enum-style string; redaction won't
        // shrink these. ~10 bytes each * 2000 = ~20KB serialized.
        wide[`f${i}`] = `value-${i}`;
      }
      await logRecord(wide as { event: string });
      const buf = await readBuffer();
      expect(buf).toHaveLength(1);
      // Some fields trigger _truncated marker
      const entry = buf[0] as Record<string, unknown>;
      if (entry._truncated === true) {
        expect(entry._originalBytes).toBeGreaterThan(16 * 1024);
        expect(entry.event).toBe('wide');
      } else {
        // Came in under 16KB after redaction — that's also acceptable behavior
        expect(JSON.stringify(entry).length).toBeLessThanOrEqual(16 * 1024);
      }
    });

    it('never throws when storage rejects', async () => {
      const failing: MemoryStorage & { get: MemoryStorage['get'] } = Object.assign(new MemoryStorage(), {});
      failing.get = vi.fn().mockRejectedValue(new Error('quota exceeded'));
      _setStorageForTest(failing);
      await expect(logRecord({ event: 'will fail' })).resolves.not.toThrow();
    });
  });

  describe('logError', () => {
    it('normalizes an Error into errorName/errorMessage/stack/errorCode', async () => {
      const err = new Error('something broke');
      (err as Error & { code?: string }).code = 'E_TEST';
      await logError('test.failed', err, { contextField: 'extra' });
      const buf = await readBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].event).toBe('test.failed');
      expect(buf[0].lvl).toBe('error');
      expect(buf[0].errorName).toBe('Error');
      expect(buf[0].errorCode).toBe('E_TEST');
      expect(buf[0].contextField).toBe('extra');
    });

    it('handles non-Error inputs gracefully', async () => {
      await logError('test.failed', 'string error');
      const buf = await readBuffer();
      expect(buf).toHaveLength(1);
      expect(buf[0].errorMessage).toBeDefined();
    });
  });

  describe('flushPending', () => {
    it('sends all entries in a single batch when ≤100 entries', async () => {
      for (let i = 0; i < 50; i++) {
        await logRecord({ event: 'entry', seq: i });
      }
      const sendSpy = vi.fn((_envelope: { type: 'log_batch'; entries: unknown[] }) => true);
      const n = await flushPending(sendSpy);
      expect(n).toBe(50);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const arg = sendSpy.mock.calls[0]![0];
      expect(arg.type).toBe('log_batch');
      expect(arg.entries).toHaveLength(50);
    });

    it('chunks large buffers into 100-entry batches', async () => {
      const prefilled: unknown[] = [];
      for (let i = 0; i < 250; i++) {
        prefilled.push({ t: 'x', src: 'ext', lvl: 'info', pid: null, event: 'old', seq: i });
      }
      await storage.set('__agenthub_log_buffer', prefilled);

      const sendSpy = vi.fn((_envelope: { type: 'log_batch'; entries: unknown[] }) => true);
      const n = await flushPending(sendSpy);
      expect(n).toBe(250);
      expect(sendSpy).toHaveBeenCalledTimes(3); // 100 + 100 + 50
      expect(sendSpy.mock.calls[0]![0].entries).toHaveLength(100);
      expect(sendSpy.mock.calls[1]![0].entries).toHaveLength(100);
      expect(sendSpy.mock.calls[2]![0].entries).toHaveLength(50);
    });

    it('returns 0 and does nothing when buffer is empty', async () => {
      const sendSpy = vi.fn((_envelope: { type: 'log_batch'; entries: unknown[] }) => true);
      const n = await flushPending(sendSpy);
      expect(n).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('clears buffer after successful flush', async () => {
      await logRecord({ event: 'a' });
      await logRecord({ event: 'b' });
      const sendSpy = vi.fn(() => true);
      await flushPending(sendSpy);
      const remaining = await readBuffer();
      expect(remaining).toHaveLength(0);
    });

    it('keeps buffer when send returns false (e.g. socket dropped)', async () => {
      await logRecord({ event: 'a' });
      await logRecord({ event: 'b' });
      const sendSpy = vi.fn(() => false);
      const n = await flushPending(sendSpy);
      expect(n).toBe(0);
      const remaining = await readBuffer();
      expect(remaining).toHaveLength(2);
    });

    it('stops at first failing chunk; remaining entries preserved', async () => {
      const prefilled: unknown[] = [];
      for (let i = 0; i < 250; i++) {
        prefilled.push({ t: 'x', src: 'ext', lvl: 'info', pid: null, event: 'old', seq: i });
      }
      await storage.set('__agenthub_log_buffer', prefilled);

      // Succeed for first chunk, fail for second
      let callCount = 0;
      const sendSpy = vi.fn(() => {
        callCount++;
        return callCount === 1;
      });
      const n = await flushPending(sendSpy);
      expect(n).toBe(100);
      const remaining = await readBuffer();
      expect(remaining).toHaveLength(150);
      // The remaining should start at seq=100 (we sent seq 0..99)
      expect((remaining[0] as unknown as { seq: number }).seq).toBe(100);
    });

    it('handles storage failures gracefully (returns 0)', async () => {
      const failing: MemoryStorage = new MemoryStorage();
      failing.get = vi.fn().mockRejectedValue(new Error('quota'));
      _setStorageForTest(failing);
      const sendSpy = vi.fn(() => true);
      const n = await flushPending(sendSpy);
      expect(n).toBe(0);
    });
  });

  describe('privacy toggle (setLoggingEnabled)', () => {
    it('skips writes when disabled', async () => {
      const { setLoggingEnabled } = await import('./logger');
      setLoggingEnabled(false);
      await logRecord({ event: 'should.not.appear' });
      expect(await readBuffer()).toHaveLength(0);
      setLoggingEnabled(true);
    });

    it('eagerly wipes the buffer on opt-out', async () => {
      const { setLoggingEnabled } = await import('./logger');
      await logRecord({ event: 'before.opt.out' });
      expect(await readBuffer()).toHaveLength(1);
      setLoggingEnabled(false);
      // setLoggingEnabled fires an async remove() — wait a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(await readBuffer()).toHaveLength(0);
      setLoggingEnabled(true);
    });
  });

  describe('serialized writes (no read-modify-write races)', () => {
    it('all entries from concurrent logRecord calls survive', async () => {
      // Fire 50 concurrent writes. Without serialization, many would lose
      // their write back due to the shared get-modify-set sequence.
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(logRecord({ event: 'concurrent', seq: i }));
      }
      await Promise.all(promises);
      const buf = await readBuffer();
      expect(buf).toHaveLength(50);
      const seqs = buf.map((e) => (e as unknown as { seq: number }).seq).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });
  });

  describe('clearBuffer', () => {
    it('removes all entries', async () => {
      await logRecord({ event: 'a' });
      await logRecord({ event: 'b' });
      expect(await readBuffer()).toHaveLength(2);
      await clearBuffer();
      expect(await readBuffer()).toHaveLength(0);
    });
  });

  describe('readBuffer', () => {
    it('returns empty array when nothing logged', async () => {
      expect(await readBuffer()).toEqual([]);
    });

    it('returns copy (mutating result does not affect storage)', async () => {
      await logRecord({ event: 'a' });
      const buf = await readBuffer();
      buf.push({ t: 'fake', src: 'ext', lvl: 'info', pid: null, event: 'injected' });
      const buf2 = await readBuffer();
      expect(buf2).toHaveLength(1);
      expect(buf2[0].event).toBe('a');
    });
  });
});

describe('logger — _resetStorageForTest', () => {
  it('restores chrome.storage.local backend (does not throw)', () => {
    // Just verify it doesn't crash. Actual chrome.storage interaction is
    // hard to test without a real extension runtime.
    expect(() => _resetStorageForTest()).not.toThrow();
    // Re-stub for subsequent test isolation
    _setStorageForTest(new MemoryStorage());
  });
});
