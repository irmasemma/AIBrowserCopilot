/**
 * Helper-side logger.
 *
 * The native messaging helper is short-lived: Chrome invokes it once per
 * action, it writes one response, then exits. So there's no need for a
 * long-running rotation manager, in-memory byte counter, or batched flushes.
 *
 * Behavior per invocation:
 *   1. Lazy-resolve %LOCALAPPDATA%/agenthub/logs/helper.log
 *   2. If file exists and > 1 MB, rotate (.log → .log.1 → .log.2 → ...
 *      up to .log.4; oldest is overwritten)
 *   3. Append one or more NDJSON lines
 *   4. Close, let process exit
 *
 * Errors during file I/O are SWALLOWED. A broken logger must never crash
 * the helper — Chrome treats helper exit-codes as native-messaging-host
 * errors, which silently breaks discovery.
 *
 * Redaction:
 *   - All payloads pass through redact() first
 *   - Errors go through redactError()
 *   - Same module shared with bridge + extension
 */

import { existsSync, statSync, renameSync, appendFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { redact, redactError } from './redaction.js';

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
const KEEP_GENERATIONS = 5; // .log + .log.1..4

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function getInstallDir(): string {
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'agenthub');
  return join(homedir(), '.agenthub');
}

function getHelperLogPath(): string {
  return join(getInstallDir(), 'logs', 'helper.log');
}

/**
 * Privacy toggle. Reads `<installDir>/logs-config.json` once per process.
 * If `{ "enabled": false }`, all log writes are skipped (helper writes
 * nothing). Default and fallback on parse error: enabled.
 *
 * Mirrors the bridge's behavior — both consult the same config file so
 * a single user toggle disables logging across the entire system.
 */
let _enabled: boolean | null = null;
function isLoggingEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  try {
    const configPath = join(getInstallDir(), 'logs-config.json');
    if (!existsSync(configPath)) { _enabled = true; return true; }
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as { enabled?: unknown };
    _enabled = parsed.enabled !== false;
    return _enabled;
  } catch {
    _enabled = true;
    return true;
  }
}

/**
 * Rotate <path> → <path>.1 → <path>.2 → ... up to KEEP_GENERATIONS - 1.
 * Skips silently on EPERM/EBUSY (file in use, antivirus locking, etc).
 *
 * Important: on Windows, `renameSync` will fail with EPERM if the target
 * already exists. Walk newest → oldest (highest index first) and unlink
 * the destination before renaming to make this safe.
 */
function rotateIfNeeded(filePath: string): void {
  try {
    if (!existsSync(filePath)) return;
    const sz = statSync(filePath).size;
    if (sz < MAX_FILE_BYTES) return;

    // Drop the very oldest generation if it exists.
    const oldest = `${filePath}.${KEEP_GENERATIONS - 1}`;
    try { if (existsSync(oldest)) unlinkSync(oldest); } catch { /* ignore */ }

    // Shift remaining generations: .{k-2} → .{k-1}, ..., .1 → .2
    for (let i = KEEP_GENERATIONS - 2; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dst = `${filePath}.${i + 1}`;
      if (!existsSync(src)) continue;
      try {
        if (existsSync(dst)) unlinkSync(dst);
        renameSync(src, dst);
      } catch {
        // EPERM/EBUSY — skip; rotation is best-effort. Next invocation retries.
      }
    }

    // Final shift: .log → .log.1
    try {
      const dst = `${filePath}.1`;
      if (existsSync(dst)) unlinkSync(dst);
      renameSync(filePath, dst);
    } catch {
      // ignore
    }
  } catch {
    // Stat/exists failed — give up rotation, the append below will still try.
  }
}

/**
 * Write a single structured log entry to helper.log.
 *
 * @param input.event - required event name (e.g. "helper.invoke.received")
 * @param input.lvl   - optional log level (default 'info')
 * @param input.*     - any extra fields (will be redacted)
 */
export function logRecord(input: { event: string; lvl?: LogLevel; [k: string]: unknown }): void {
  if (!isLoggingEnabled()) return;
  try {
    const { event, lvl, ...rest } = input;
    const redacted = redact(rest) as Record<string, unknown>;
    const entry = {
      t: new Date().toISOString(),
      src: 'helper',
      lvl: lvl ?? 'info',
      pid: process.pid,
      event,
      ...redacted,
    };
    const line = JSON.stringify(entry) + '\n';

    const filePath = getHelperLogPath();
    const dir = join(getInstallDir(), 'logs');
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch { return; }
    }
    rotateIfNeeded(filePath);
    appendFileSync(filePath, line);
  } catch {
    // Best-effort only.
  }
}

/**
 * Convenience: log an error with normalized errorName/errorMessage/stack.
 */
export function logErr(event: string, err: unknown, extra: Record<string, unknown> = {}): void {
  logRecord({ event, lvl: 'error', ...extra, ...redactError(err) });
}
