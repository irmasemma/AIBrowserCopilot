/**
 * Extension-side structured logger.
 *
 * Why a ring buffer in chrome.storage.local instead of in-memory?
 *   Chrome MV3 service workers are evicted aggressively. Any logs held only
 *   in module-level state vanish when the SW dies. By persisting each log
 *   line to chrome.storage.local immediately, the next SW that wakes up
 *   can read the buffer and flush it to the bridge — even if the death
 *   itself happened mid-tool-call.
 *
 * Why send to bridge instead of writing files from extension?
 *   The extension has no filesystem access. The bridge does. Extension
 *   sends a `{type:'log_batch', entries:[...]}` envelope; bridge writes to
 *   `<installDir>/logs/extension.log` via the same logger module used for
 *   bridge.log.
 *
 * Buffer policy:
 *   - Max 500 entries (FIFO drop-oldest on overflow)
 *   - Single chrome.storage.local key: AGENTHUB_LOG_BUFFER_KEY
 *   - Each entry is a small JSON record (~200B typical)
 *   - 500 * 200B = ~100KB max — well under storage.local quotas
 *
 * Flush trigger:
 *   - Caller invokes flushPending(send) when WS becomes ready
 *   - On success, buffer is cleared
 *   - On send failure, buffer is preserved for next attempt
 *
 * Redaction:
 *   - All values pass through redact() before write
 *   - Same rules as bridge: URLs→host, text→[len=N], secrets→[REDACTED-SECRET]
 *   - Errors normalized via redactError()
 *
 * This module must NEVER throw — a logger that crashes the SW is worse
 * than no logger. Internal failures are swallowed (best-effort logging).
 */

import { redact, redactError } from './redaction';

const AGENTHUB_LOG_BUFFER_KEY = '__agenthub_log_buffer';
const AGENTHUB_LOGS_ENABLED_KEY = '__agenthub_logs_enabled';
const MAX_BUFFER_ENTRIES = 500;
const MAX_ENTRY_BYTES = 16 * 1024;
const MAX_BATCH_ENTRIES = 100;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  t: string;
  src: string;
  lvl: LogLevel;
  pid: number | null;
  event: string;
  [key: string]: unknown;
}

export interface LoggerStorage {
  get(key: string): Promise<unknown[]>;
  set(key: string, value: unknown[]): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Default storage implementation that reads/writes chrome.storage.local. */
function defaultChromeStorage(): LoggerStorage {
  return {
    get(key) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(key, (items) => {
            if (chrome.runtime.lastError) { resolve([]); return; }
            const v = (items as Record<string, unknown>)[key];
            resolve(Array.isArray(v) ? (v as unknown[]) : []);
          });
        } catch {
          resolve([]);
        }
      });
    },
    set(key, value) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.set({ [key]: value }, () => {
            // Quota-exceeded surfaces via lastError. Drop silently — better
            // to lose recent logs than to crash the SW.
            if (chrome.runtime.lastError) { resolve(); return; }
            resolve();
          });
        } catch {
          resolve();
        }
      });
    },
    remove(key) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.remove(key, () => resolve());
        } catch {
          resolve();
        }
      });
    },
  };
}

let activeStorage: LoggerStorage = defaultChromeStorage();

/**
 * Override storage backend (test seam). Real callers should not invoke
 * this — the default chrome.storage.local backend is correct in prod.
 */
export function _setStorageForTest(storage: LoggerStorage): void {
  activeStorage = storage;
}

export function _resetStorageForTest(): void {
  activeStorage = defaultChromeStorage();
  setLoggingEnabled(true);
}

// ── Privacy toggle ─────────────────────────────────────────────────────
// The extension keeps its own enabled flag (defaults true) because Chrome
// extensions can't read the bridge's logs-config.json directly. The flag
// is set via `setLoggingEnabled()` — driven by either:
//   (a) the side-panel UI's privacy toggle (writes chrome.storage.local)
//   (b) bridge broadcasting its enabled state in server_info on connect
// When disabled, logRecord() is a no-op AND any persisted buffer is wiped.
let _enabled = true;
export function setLoggingEnabled(enabled: boolean): void {
  _enabled = enabled;
  if (!enabled) {
    // Eagerly wipe the persisted buffer so an opt-out takes effect immediately
    // (not just on next flush).
    try { void activeStorage.remove(AGENTHUB_LOG_BUFFER_KEY); } catch { /* ignore */ }
  }
}
export function isLoggingEnabled(): boolean {
  return _enabled;
}

// ── Serialized write queue ──────────────────────────────────────────────
// chrome.storage.local has no atomic read-modify-write primitive. Multiple
// concurrent logRecord() calls would race (each reads the same buffer,
// appends one entry, writes back — last writer wins, others lost). We
// serialize through a single-flight promise chain. This is in-memory only;
// SW eviction loses the queue, but that's no worse than losing the logs
// themselves (and the next SW life starts with whatever was committed).
let writeQueue: Promise<void> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work, work);
  // Keep the chain alive even if `work` throws — the chain's failure
  // shouldn't block the next caller.
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Append a structured log entry to the ring buffer.
 *
 * Behavior:
 *   - Adds `t` (ISO timestamp) and `src='ext'` if missing
 *   - Redacts all values via redact() (key-based + shape-based)
 *   - If serialized size > MAX_ENTRY_BYTES: replaced with a truncation marker
 *   - If buffer grows past MAX_BUFFER_ENTRIES: oldest entries dropped
 *   - All writes go through a single-flight queue (no concurrent RMW races)
 *   - On any storage error: silently dropped (no exceptions propagate)
 */
export async function logRecord(input: Partial<LogRecord> & { event: string; lvl?: LogLevel }): Promise<void> {
  if (!_enabled) return;
  return enqueue(async () => {
    try {
      // Split metadata fields (preserved verbatim) from payload fields
      // (run through key-based redaction so { url: ..., text: ..., cookie: ... }
      // hit URL_KEYS / TEXT_KEYS / SECRET_KEYS rules respectively).
      const { t: _t, src: _src, lvl: _lvl, pid: _pid, event: _event, ...payload } = input;
      const redactedPayload = redact(payload) as Record<string, unknown>;

      const entry: LogRecord = {
        t: _t ?? new Date().toISOString(),
        src: _src ?? 'ext',
        lvl: _lvl ?? 'info',
        pid: _pid ?? null,
        event: _event,
        ...redactedPayload,
      };

      let serialized: string;
      try {
        serialized = JSON.stringify(entry);
      } catch {
        // Cyclic / un-stringifiable value — log a fallback record instead.
        serialized = JSON.stringify({
          t: entry.t, src: entry.src, lvl: entry.lvl, pid: entry.pid,
          event: entry.event, _serializationError: true,
        });
      }

      if (serialized.length > MAX_ENTRY_BYTES) {
        const truncated = {
          t: entry.t, src: entry.src, lvl: entry.lvl, pid: entry.pid,
          event: entry.event, _truncated: true, _originalBytes: serialized.length,
        };
        serialized = JSON.stringify(truncated);
      }

      const reparsed = JSON.parse(serialized);
      const buffer = await activeStorage.get(AGENTHUB_LOG_BUFFER_KEY);
      buffer.push(reparsed);
      while (buffer.length > MAX_BUFFER_ENTRIES) {
        buffer.shift();
      }
      await activeStorage.set(AGENTHUB_LOG_BUFFER_KEY, buffer);
    } catch {
      // Best-effort logging only — never propagate.
    }
  });
}

/**
 * Convenience wrapper that normalizes an error before logging.
 */
export async function logError(event: string, err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  await logRecord({ event, lvl: 'error', ...extra, ...redactError(err) });
}

/**
 * Send all buffered entries to the bridge via the provided `send` fn.
 *
 * Critical design notes:
 *   - We capture a snapshot of the buffer BEFORE sending so concurrent
 *     logRecord() calls during flush don't get wiped.
 *   - The send callback returns a bool — true means "delivered to WS
 *     send queue, safe to drop". On false (no live socket), we keep
 *     the entries.
 *   - After successful send, we remove ONLY the entries we actually sent
 *     (read fresh buffer → splice off the snapshot length → write back).
 *   - Chunked at MAX_BATCH_ENTRIES (100) to avoid 1 MB+ WS frames.
 *
 * @returns Number of entries successfully sent
 */
export async function flushPending(
  send: (envelope: { type: 'log_batch'; entries: unknown[] }) => boolean | void,
): Promise<number> {
  return enqueue(async () => {
    try {
      const snapshot = await activeStorage.get(AGENTHUB_LOG_BUFFER_KEY);
      if (snapshot.length === 0) return 0;

      let sentCount = 0;
      for (let i = 0; i < snapshot.length; i += MAX_BATCH_ENTRIES) {
        const chunk = snapshot.slice(i, i + MAX_BATCH_ENTRIES);
        const ok = send({ type: 'log_batch', entries: chunk });
        if (ok === false) break; // Socket dropped mid-flush; preserve unsent + retry later
        sentCount += chunk.length;
      }
      if (sentCount === 0) return 0;

      // Trim only the prefix we actually sent. Re-reading is important —
      // logRecord() calls during the await above will have appended entries
      // we DIDN'T send, and those must survive the trim.
      const fresh = await activeStorage.get(AGENTHUB_LOG_BUFFER_KEY);
      const remaining = fresh.slice(sentCount);
      if (remaining.length === 0) {
        await activeStorage.remove(AGENTHUB_LOG_BUFFER_KEY);
      } else {
        await activeStorage.set(AGENTHUB_LOG_BUFFER_KEY, remaining);
      }
      return sentCount;
    } catch {
      return 0;
    }
  });
}

/**
 * Read the current buffer without clearing it. Useful for diagnostics UIs
 * that want to display recent log lines.
 */
export async function readBuffer(): Promise<LogRecord[]> {
  try {
    const buffer = await activeStorage.get(AGENTHUB_LOG_BUFFER_KEY);
    return buffer as LogRecord[];
  } catch {
    return [];
  }
}

/**
 * Force-clear the buffer. Used by the privacy "Clear logs" UI button.
 */
export async function clearBuffer(): Promise<void> {
  try {
    await activeStorage.remove(AGENTHUB_LOG_BUFFER_KEY);
  } catch {
    // ignore
  }
}

// Storage key constants exposed for callers that need them (e.g. side
// panel UI listening for chrome.storage.onChanged events).
export const STORAGE_KEYS = {
  buffer: AGENTHUB_LOG_BUFFER_KEY,
  enabledFlag: AGENTHUB_LOGS_ENABLED_KEY,
} as const;
