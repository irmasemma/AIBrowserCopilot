import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import type { PlatformInfo } from '../shared/platform.js';
import { getInstallDir } from '../shared/platform.js';

export const NATIVE_HOST_PORT = 7483;

export interface KillResult {
  /** Whether at least one running native host was found and terminated. */
  killed: boolean;
  /** PID of the first process terminated (port owner if known). Kept for
   *  backward compat — see `pids` for the full list when multiple were killed. */
  pid?: number;
  /** All PIDs that were terminated. Empty when nothing was running. */
  pids?: number[];
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

/**
 * Enumerate all PIDs running the given executable image (e.g.
 * `ai-browser-copilot-win-x64.exe`). On Windows multiple bridge instances
 * (one per Chrome profile, or stale orphans) all hold an exclusive lock on
 * the .exe file — killing only the port-owner isn't enough to free the file
 * for an in-place upgrade.
 *
 * Windows: `tasklist /FI "IMAGENAME eq <image>"` (CSV).
 * POSIX:   `pgrep -f <image>` (matches the basename in cmdline).
 */
export const findPidsByImageName = (
  imageName: string,
  platform: PlatformInfo,
): number[] => {
  try {
    if (platform.os === 'windows') {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pids: number[] = [];
      for (const line of out.split(/\r?\n/)) {
        // Lines look like: "image.exe","12345","Console","2","36,264 K"
        const m = line.match(/^"[^"]+","(\d+)"/);
        if (m) {
          const pid = parseInt(m[1], 10);
          if (Number.isFinite(pid)) pids.push(pid);
        }
      }
      return pids;
    }
    const out = execSync(`pgrep -f ${imageName}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .trim()
      .split(/\s+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    // tasklist with no matches still exits 0 on Win10+, but pgrep exits 1.
    // Either way, treat command failure as "no matches".
    return [];
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
 * Find and terminate every running native-host instance so the installer can
 * replace the binary file(s).
 *
 * Strategy: collect candidate PIDs from three sources, dedupe, and kill them
 * all. A single port owner is not sufficient — multiple bridge processes can
 * be running (one per Chrome profile under the multi-profile design, or stale
 * orphans from prior crashes), and on Windows EVERY running .exe holds an
 * exclusive lock on its image file. Missing one means the rename in
 * `binary-installer` fails with EPERM.
 *
 * Sources:
 *   1. Whoever is currently listening on the bridge's port (the active one).
 *   2. The PID recorded in `server.lock` (might be stale or different).
 *   3. Every process whose image name matches one of `imageNames`
 *      (catches background instances + helper).
 *
 * Then: kill each unique PID, wait for the port to free (≤5s), drop the
 * lock file. Idempotent: with nothing running, returns `{killed:false}`.
 */
export const killRunningNativeHost = async (
  platform: PlatformInfo,
  port: number = NATIVE_HOST_PORT,
  imageNames: string[] = [],
): Promise<KillResult> => {
  const pidsToKill = new Set<number>();
  let portPid: number | null = null;

  // Image-name matches always need to die regardless of port state — even
  // if the port is free, sibling instances still hold .exe file locks.
  for (const imageName of imageNames) {
    for (const pid of findPidsByImageName(imageName, platform)) {
      pidsToKill.add(pid);
    }
  }

  // Only consult the port / lock file when the port is actually in use.
  // The lock file is shared install-state — its PID corresponds to the
  // bridge bound to NATIVE_HOST_PORT, not whatever `port` we were called
  // with, so blindly adding it would kill an unrelated process.
  const portInUse = !(await isPortFree(port));
  if (portInUse) {
    portPid = findPidByPort(port, platform) ?? findPidFromLockFile(platform);
    if (portPid != null) {
      pidsToKill.add(portPid);
    } else if (pidsToKill.size === 0) {
      return {
        killed: false,
        portFree: false,
        pids: [],
        error: `Port ${port} is in use but no PID could be identified`,
      };
    }
  }

  if (pidsToKill.size === 0) {
    removeStaleLockFile(platform);
    return { killed: false, portFree: true, pids: [] };
  }

  // Kill the port owner first so the listener is gone before we wait for
  // the port to free; the order otherwise doesn't matter.
  const ordered = portPid != null
    ? [portPid, ...Array.from(pidsToKill).filter((p) => p !== portPid)]
    : Array.from(pidsToKill);

  const killedPids: number[] = [];
  const errors: string[] = [];
  for (const pid of ordered) {
    const r = killPid(pid, platform);
    if (r.ok) killedPids.push(pid);
    else if (r.error) errors.push(`pid ${pid}: ${r.error}`);
  }

  const portFree = await waitForPortFree(port, 5000);
  removeStaleLockFile(platform);

  return {
    killed: killedPids.length > 0,
    pid: killedPids[0],
    pids: killedPids,
    portFree,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
};
