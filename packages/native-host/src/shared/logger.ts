/**
 * Structured NDJSON logger with size-based rotation.
 *
 * Used by the bridge (native-host) and helper (native-host-helper).
 * One log line = one JSON object, written to a single file per `src`
 * (e.g. `bridge.log`, `extension.log`, `helper.log`). When the file
 * crosses `MAX_BYTES`, it rotates: `.log` → `.log.1`, `.log.1` → `.log.2`,
 * dropping `.log.4`.
 *
 * Design choices (see plan.md "Structured logging — implementation spec"):
 *
 *   - **Open/write/close per call.** No held file handle. Necessary on
 *     Windows because a held handle blocks rename — and we need to
 *     rename to rotate. Per-call `appendFileSync` is fast enough
 *     (~50 µs); we are not a high-throughput logger.
 *
 *   - **No `fsync` per call.** Crash durability of the last few lines is
 *     not worth tanking call latency. The OS page cache flushes on its
 *     own schedule. Bridge crash handler does flush the line that
 *     records the crash itself; that's all we strictly need.
 *
 *   - **In-memory byte counter** tracks current file size. Cheaper than
 *     `statSync` on every write. We resync from disk on rotation and on
 *     first write of a new process.
 *
 *   - **Logger NEVER throws.** A disk full / permissions error must not
 *     break the caller. Errors are swallowed silently; if the logger
 *     itself is broken we'd rather lose logs than crash the bridge.
 *
 *   - **Rotation can fail safely.** On Windows, `renameSync` over an
 *     open file (e.g. someone tail -F'ing the log) returns `EPERM` /
 *     `EBUSY`. We swallow these and skip rotation; the log file just
 *     temporarily exceeds the threshold and gets retried next write.
 *
 * Redaction is OUT of scope for this module. Callers must pass
 * already-redacted fields. See `redaction.ts`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'bridge' | 'ext' | 'helper';

export interface LogRecord {
  /** ISO timestamp, set by logger if absent (so callers don't have to). */
  t?: string;
  src: LogSource;
  lvl: LogLevel;
  /** Process PID. Null for extension SW (no PID available). */
  pid: number | null;
  /** Short kebab-case event name, e.g. 'mcp.tools_call.received'. */
  event: string;
  /** Anything else. Caller responsible for redaction. */
  [k: string]: unknown;
}

export interface LoggerConfig {
  /** Absolute path to the log file (e.g. `<installDir>/logs/bridge.log`). */
  filePath: string;
  /** Per-file size cap. Defaults to 1 MB. */
  maxBytes?: number;
  /** Generations to keep (.log + .log.1 .. .log.<keep>). Defaults to 4. */
  keep?: number;
}

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_KEEP = 4;

/**
 * Single-line safety cap. If a caller serializes a giant blob (e.g. a
 * full page snapshot that escaped redaction) we truncate to avoid
 * polluting a whole rotation generation with one entry.
 */
const MAX_LINE_BYTES = 16_000;

/**
 * Privacy toggle. Users (or enterprise admins) can drop
 * `<installDir>/logs-config.json` containing `{ "enabled": false }` to
 * disable all log file writes. Default is enabled (true). The check is
 * cached per process — restart the bridge to pick up changes.
 *
 * This is a binary kill-switch, not a verbosity level. For finer-grained
 * control (e.g. drop heartbeats only), filter at the caller. Future plan:
 * add `level: 'minimal'|'standard'|'verbose'` once we have telemetry on
 * which events are most actionable.
 */
let _loggingEnabled: boolean | null = null;
function isLoggingEnabled(filePath: string): boolean {
  if (_loggingEnabled !== null) return _loggingEnabled;
  try {
    // logs-config.json sits one level above logs/bridge.log → ../logs-config.json
    const configPath = join(dirname(dirname(filePath)), 'logs-config.json');
    if (!existsSync(configPath)) {
      _loggingEnabled = true;
      return true;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    _loggingEnabled = parsed.enabled !== false;
    return _loggingEnabled;
  } catch {
    // Malformed config → default to enabled (fail-open). Users who care
    // about privacy will notice no log file and check their config.
    _loggingEnabled = true;
    return true;
  }
}

/** Test seam: reset cached enabled state. */
export function _resetForTest(): void {
  states.clear();
  _loggingEnabled = null;
}

/**
 * Maintains an in-memory size counter so we don't statSync per write.
 * Resync from disk on construct and after rotation. Tracked separately
 * per logger instance — fine, each process has its own bridge.log etc.
 */
interface LoggerState {
  filePath: string;
  maxBytes: number;
  keep: number;
  currentBytes: number;
  /** Set when the destination dir creation fails; logger becomes a no-op. */
  disabled: boolean;
}

const states = new Map<string, LoggerState>();

function getOrInit(cfg: LoggerConfig): LoggerState {
  const existing = states.get(cfg.filePath);
  if (existing) return existing;

  const state: LoggerState = {
    filePath: cfg.filePath,
    maxBytes: cfg.maxBytes ?? DEFAULT_MAX_BYTES,
    keep: cfg.keep ?? DEFAULT_KEEP,
    currentBytes: 0,
    disabled: false,
  };

  // Best-effort: ensure the directory exists. If this fails (e.g. read-only
  // disk), mark the logger disabled so we don't crash on every write.
  try {
    const dir = dirname(cfg.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    state.disabled = true;
    states.set(cfg.filePath, state);
    return state;
  }

  // Resync from disk if the file already exists (e.g. previous run of the
  // same process). One-time cost per logger.
  try {
    if (existsSync(cfg.filePath)) {
      state.currentBytes = statSync(cfg.filePath).size;
    }
  } catch {
    // statSync failed but appendFileSync may still work; treat size as 0.
  }

  states.set(cfg.filePath, state);
  return state;
}

/**
 * Rotate the log file generations. Walks oldest → newest so that each
 * rename targets a non-existent slot.
 *
 * Returns true if rotation succeeded (the .log file is now ready to be
 * a fresh empty file), false if it was skipped due to an error. On
 * failure we leave the log file in place; the caller continues to append
 * past the threshold until next attempt.
 */
function rotate(state: LoggerState): boolean {
  const { filePath, keep } = state;
  // Drop the oldest generation.
  try {
    if (existsSync(`${filePath}.${keep}`)) unlinkSync(`${filePath}.${keep}`);
  } catch {
    // Drop attempted, will retry next cycle. Don't abort the rotation.
  }
  // Shift remaining generations: .3 → .4, .2 → .3, .1 → .2
  for (let i = keep - 1; i >= 1; i--) {
    try {
      if (existsSync(`${filePath}.${i}`)) {
        renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
      }
    } catch {
      // EPERM/EBUSY — someone has it open (tail -f, antivirus, indexer).
      // Bail this rotation cycle; we'll try again next write.
      return false;
    }
  }
  // Final shift: .log → .log.1
  try {
    if (existsSync(filePath)) {
      renameSync(filePath, `${filePath}.1`);
    }
  } catch {
    return false;
  }
  return true;
}

function serialize(rec: LogRecord): string {
  // Stamp timestamp if absent. Callers can pre-set `t` for deterministic
  // testing.
  if (!rec.t) rec.t = new Date().toISOString();
  let line: string;
  try {
    line = JSON.stringify(rec);
  } catch {
    // Circular ref or unserialisable. Strip to known-safe fields.
    line = JSON.stringify({
      t: rec.t,
      src: rec.src,
      lvl: rec.lvl,
      pid: rec.pid,
      event: rec.event,
      _serialize_failed: true,
    });
  }
  // Single-line safety. We never want one bad record to flood a whole
  // rotation generation. 16 KB is generous for legitimate records.
  if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) {
    line = JSON.stringify({
      t: rec.t,
      src: rec.src,
      lvl: rec.lvl,
      pid: rec.pid,
      event: rec.event,
      _truncated: true,
      _originalBytes: Buffer.byteLength(line, 'utf-8'),
    });
  }
  return line + '\n';
}

/**
 * Write one log record. Never throws. Returns silently on any error
 * (disk full, permissions, disabled).
 *
 * Performance: ~50–200 µs per call on local SSD. Acceptable for the
 * ~10 calls/sec the bridge ever does at peak.
 */
export function logRecord(cfg: LoggerConfig, rec: LogRecord): void {
  if (!isLoggingEnabled(cfg.filePath)) return;
  const state = getOrInit(cfg);
  if (state.disabled) return;

  const line = serialize(rec);
  const bytes = Buffer.byteLength(line, 'utf-8');

  // Rotate BEFORE this write if it would push us over. Note: a single
  // huge line (after MAX_LINE_BYTES cap) can still push slightly over;
  // that's fine, the next write triggers another rotation.
  if (state.currentBytes + bytes > state.maxBytes) {
    if (rotate(state)) {
      state.currentBytes = 0;
    }
    // If rotation failed (EPERM/EBUSY), we continue appending past the
    // threshold rather than dropping the line. Better to have a slightly
    // oversized file than silent data loss.
  }

  try {
    appendFileSync(state.filePath, line, 'utf-8');
    state.currentBytes += bytes;
  } catch {
    // Disk full / permissions error. Swallow silently. We do not want
    // a logger failure to crash the bridge or extension.
  }
}

/**
 * Convenience wrappers — these all funnel through `logRecord`.
 * Callers pass a partial record; we fill in src + lvl + pid.
 */
export function makeLogger(cfg: LoggerConfig, src: LogSource, pid: number | null) {
  return {
    info(event: string, fields?: Record<string, unknown>): void {
      logRecord(cfg, { src, lvl: 'info', pid, event, ...fields });
    },
    warn(event: string, fields?: Record<string, unknown>): void {
      logRecord(cfg, { src, lvl: 'warn', pid, event, ...fields });
    },
    error(event: string, fields?: Record<string, unknown>): void {
      logRecord(cfg, { src, lvl: 'error', pid, event, ...fields });
    },
  };
}

export type Logger = ReturnType<typeof makeLogger>;

/**
 * Test helper: clear the in-memory state cache and cached config. Lets a
 * test create fresh state for the same path between cases.
 *
 * (Earlier draft also defines `_resetForTest` — this replaces that copy.)
 */
// Re-exported above; intentionally left as a no-op block to keep diffs
// minimal. The canonical definition lives near the top of this file
// (under the privacy toggle section).
