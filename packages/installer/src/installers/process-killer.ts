import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import type { PlatformInfo } from '../shared/platform.js';
import { getInstallDir } from '../shared/platform.js';

export const NATIVE_HOST_PORT = 7483;

export interface KillResult {
  /** Whether a running native host was found and terminated. */
  killed: boolean;
  /** PID of the process that was terminated, if any. */
  pid?: number;
  /** Error message if termination was attempted but failed. */
  error?: string;
  /** Whether the port became free after the kill (or was already free). */
  portFree: boolean;
}

/**
 * Look up the PID currently listening on `port` (TCP, IPv4 loopback).
 * Windows: `netstat -ano`. POSIX: `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`.
 */
export const findPidByPort = (port: number, platform: PlatformInfo): number | null => {
  try {
    if (platform.os === 'windows') {
      const out = execSync(`netstat -ano -p TCP`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // Match lines like:  TCP    127.0.0.1:7483    0.0.0.0:0    LISTENING    19440
      const re = new RegExp(
        `^\\s*TCP\\s+(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|\\[::\\]):${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`,
        'm',
      );
      const m = out.match(re);
      return m ? parseInt(m[1], 10) : null;
    }
    // macOS / Linux
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const pid = parseInt(out.split(/\s+/)[0], 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    // Command failed (no process listening, lsof missing, etc.) — treat as "not found"
    return null;
  }
};

/** Best-effort: read the bridge's lock file and return its PID. */
export const findPidFromLockFile = (platform: PlatformInfo): number | null => {
  try {
    const lockPath = join(getInstallDir(platform), 'server.lock');
    if (!existsSync(lockPath)) return null;
    const data = JSON.parse(readFileSync(lockPath, 'utf-8'));
    return typeof data?.pid === 'number' ? data.pid : null;
  } catch {
    return null;
  }
};

/** Probe whether `port` is free by attempting a quick TCP connect. */
export const isPortFree = (port: number, timeoutMs = 500): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (free: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.once('timeout', () => finish(true));
  });
};

/** Wait until `port` is free, polling every 100 ms up to `timeoutMs`. */
export const waitForPortFree = async (
  port: number,
  timeoutMs = 5000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return await isPortFree(port);
};

/**
 * Forcibly terminate a process by PID. Windows: `taskkill /PID <pid> /F`.
 * POSIX: `process.kill(pid, 'SIGTERM')` then `'SIGKILL'` if still alive.
 */
export const killPid = (pid: number, platform: PlatformInfo): { ok: boolean; error?: string } => {
  try {
    if (platform.os === 'windows') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', timeout: 5000 });
      return { ok: true };
    }
    process.kill(pid, 'SIGTERM');
    // Give it a moment, then SIGKILL if still alive
    const start = Date.now();
    while (Date.now() - start < 1000) {
      try {
        process.kill(pid, 0);
      } catch {
        return { ok: true };
      }
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // taskkill returns non-zero if the PID is already gone — that's fine.
    if (/not\s+found|no\s+process|cannot\s+find/i.test(msg)) {
      return { ok: true };
    }
    return { ok: false, error: msg };
  }
};

const removeStaleLockFile = (platform: PlatformInfo): void => {
  try {
    const lockPath = join(getInstallDir(platform), 'server.lock');
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    // best-effort
  }
};

/**
 * Find and terminate a running native host so the installer can replace its
 * binary file. Strategy:
 *   1. Find PID by querying who owns port 7483 (authoritative).
 *   2. Fall back to the lock file if port discovery fails.
 *   3. Send taskkill / SIGTERM to that PID.
 *   4. Wait until the port is free (max 5 s).
 *   5. Remove any stale lock file.
 *
 * Idempotent: if no native host is running, returns `{killed: false, portFree: true}`.
 */
export const killRunningNativeHost = async (
  platform: PlatformInfo,
  port: number = NATIVE_HOST_PORT,
): Promise<KillResult> => {
  // Fast path: port already free, nothing to kill
  if (await isPortFree(port)) {
    removeStaleLockFile(platform);
    return { killed: false, portFree: true };
  }

  const pid = findPidByPort(port, platform) ?? findPidFromLockFile(platform);
  if (pid == null) {
    // Something is on the port but we can't identify it. Don't kill blind.
    return {
      killed: false,
      portFree: false,
      error: `Port ${port} is in use but no PID could be identified`,
    };
  }

  const killResult = killPid(pid, platform);
  if (!killResult.ok) {
    return { killed: false, pid, portFree: false, error: killResult.error };
  }

  const portFree = await waitForPortFree(port, 5000);
  removeStaleLockFile(platform);
  return { killed: true, pid, portFree };
};
