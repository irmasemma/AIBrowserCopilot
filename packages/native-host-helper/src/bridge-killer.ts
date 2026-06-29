/**
 * Kill the incumbent bridge process before a restart.
 *
 * Used exclusively by the restart_native_host handler.  Never affects
 * start_native_host (cold-start behavior is unchanged).
 *
 * Kill sequence:
 *   1. Read lock file → get incumbent pid + port.
 *      If no lock file or no pid, return immediately (nothing to kill).
 *   2. If pid is alive, terminate it.
 *      Windows : taskkill /F /T /PID <pid>
 *      POSIX   : process.kill(pid, 'SIGKILL')
 *      ESRCH / "process not found" is treated as success (already dead).
 *   3. Poll probePort until port is free (up to portWaitTimeoutMs, default 3 s).
 *   4. Defense-in-depth (documented kill-pattern bug: port-based kill leaves
 *      bind-race siblings holding the .exe lock on Windows multi-profile setups):
 *      if the port is still busy after killing the lock pid, escalate to
 *      image-name kill derived from basename(getBinaryPath()).
 *      SAFETY GUARD: if the resolved image name contains '-helper-', skip
 *      escalation and emit a warning.  getBinaryPath() must never return the
 *      helper's own binary, but this guard prevents accidental self-termination
 *      if a future regression causes it to do so.
 *   5. Wait for port to go free again after escalation.
 *
 * All external I/O (lock read, pid probe, port probe, kill) is injectable via
 * KillSeams for deterministic unit testing.
 *
 * KNOWN bounded edge case (accepted, not guarded): Chrome spawns one helper
 * process per native message, so two near-simultaneous "Restart bridge" clicks
 * run two killers concurrently. Both read the same lock pid; the second kill is
 * a no-op (ESRCH → success). If the first killer's freshly-spawned bridge binds
 * the port fast enough to appear within the second killer's ≤3 s port-wait, the
 * second killer can image-name-escalate and kill that good bridge, then spawn a
 * third. This needs sub-second double-click AND a sub-3 s bind; it self-heals on
 * the next spawn. Watch for it in logs (repeated `helper.restart.kill_complete`
 * with `escalated:true`) rather than designing a cross-process lock for it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { platform } from 'node:os';
import {
  readLockFile,
  isPidAlive,
  probePort,
  getBinaryPath,
  type LockFileInfo,
} from './service-status.js';

const execFileAsync = promisify(execFile);

const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_PORT_WAIT_TIMEOUT_MS = 3000;
/** Per-probe TCP timeout during polling — shorter than the default 1 s. */
const PORT_PROBE_POLL_MS = 300;

// ─── Seams interface ────────────────────────────────────────────────────────

export interface KillSeams {
  readLockFile?: () => LockFileInfo;
  isPidAlive?: (pid: number) => boolean;
  /** Returns true when the port is still bound (busy). */
  probePort?: (port: number) => Promise<boolean>;
  getBinaryPath?: () => string;
  /** Terminate the given PID.  May throw; callers handle ESRCH. */
  killPid?: (pid: number) => Promise<void>;
  /** Terminate all processes with the given image/binary name. */
  killByImageName?: (imageName: string) => Promise<void>;
  /** Poll interval for the port-free wait, ms (default 200). */
  pollIntervalMs?: number;
  /** Max total wait for port to become free, ms (default 3000). */
  portWaitTimeoutMs?: number;
}

// ─── Result ─────────────────────────────────────────────────────────────────

export interface KillResult {
  /** true if a kill was attempted (lock file had a pid). */
  attempted: boolean;
  /** Incumbent PID targeted, if any. */
  pid?: number;
  /** Port polled for release, if any. */
  port?: number;
  /** true if the port became free within the timeout. */
  portFree: boolean;
  /** true if image-name escalation was used (port still busy after pid kill). */
  escalated: boolean;
  /** Non-fatal diagnostic messages. */
  warnings: string[];
}

// ─── Platform kill primitives ────────────────────────────────────────────────

async function defaultKillPid(pid: number): Promise<void> {
  if (platform() === 'win32') {
    await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
  } else {
    process.kill(pid, 'SIGKILL');
  }
}

async function defaultKillByImageName(imageName: string): Promise<void> {
  if (platform() === 'win32') {
    await execFileAsync('taskkill', ['/F', '/IM', imageName]);
  } else {
    // `-f` matches the FULL command line, not just the (truncated) process name.
    // Required: the bridge binary names exceed Linux's 15-char `comm` limit
    // (e.g. `agenthub-linux-x64` is 18 chars), so a bare `pkill <imageName>`
    // would silently match nothing. Do NOT "simplify" this to bare pkill.
    await execFileAsync('pkill', ['-f', imageName]);
  }
}

// ─── Port-free polling ───────────────────────────────────────────────────────

async function waitForPortFree(
  port: number,
  pollMs: number,
  timeoutMs: number,
  probePortFn: (port: number) => Promise<boolean>,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await probePortFn(port);
    if (!busy) return true;
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function killIncumbentBridge(seams: KillSeams = {}): Promise<KillResult> {
  const readLockFileFn = seams.readLockFile ?? readLockFile;
  const isPidAliveFn = seams.isPidAlive ?? isPidAlive;
  const probePortFn =
    seams.probePort ?? ((p: number) => probePort(p, PORT_PROBE_POLL_MS));
  const getBinaryPathFn = seams.getBinaryPath ?? getBinaryPath;
  const killPidFn = seams.killPid ?? defaultKillPid;
  const killByImageNameFn = seams.killByImageName ?? defaultKillByImageName;
  const pollMs = seams.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const waitTimeoutMs = seams.portWaitTimeoutMs ?? DEFAULT_PORT_WAIT_TIMEOUT_MS;

  const warnings: string[] = [];
  const lockInfo = readLockFileFn();

  // Case (b): No lock file or no pid — nothing to kill.
  if (!lockInfo.exists || lockInfo.pid == null) {
    return { attempted: false, portFree: true, escalated: false, warnings };
  }

  const pid = lockInfo.pid;
  const port = lockInfo.port ?? 7483;

  // Step 1: Kill by PID if alive; skip gracefully if already dead (case c).
  if (isPidAliveFn(pid)) {
    try {
      await killPidFn(pid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ESRCH / "no such process" / Windows "could not be found" → already gone.
      const alreadyGone =
        msg.includes('ESRCH') ||
        msg.includes('No such process') ||
        msg.includes('not found') ||
        msg.includes('could not be found');
      if (!alreadyGone) {
        warnings.push(`PID ${pid} kill failed: ${msg}`);
      }
    }
  }

  // Step 2: Wait for the port to go free.
  const portFreeAfterKill = await waitForPortFree(port, pollMs, waitTimeoutMs, probePortFn);
  if (portFreeAfterKill) {
    return { attempted: true, pid, port, portFree: true, escalated: false, warnings };
  }

  // Step 3 (defense-in-depth): escalate to image-name kill for bind-race zombies.
  const binaryPath = getBinaryPathFn();
  const imageName = basename(binaryPath);

  // SAFETY GUARD: never kill the helper's own image.
  //   Bridge  : agenthub-<os>-<arch>[.exe]         — no '-helper-' segment.
  //   Helper  : agenthub-helper-<os>-<arch>[.exe]  — contains '-helper-'.
  if (imageName.includes('-helper-')) {
    warnings.push(
      `Image-name escalation skipped: resolved image "${imageName}" contains ` +
        `"-helper-" — this looks like the helper binary, not the bridge. ` +
        `Possible getBinaryPath() bug; not escalating to avoid self-termination.`,
    );
    return { attempted: true, pid, port, portFree: false, escalated: false, warnings };
  }

  try {
    await killByImageNameFn(imageName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Image-name kill "${imageName}" failed: ${msg}`);
  }

  const portFreeAfterEscalation = await waitForPortFree(
    port,
    pollMs,
    waitTimeoutMs,
    probePortFn,
  );

  return {
    attempted: true,
    pid,
    port,
    portFree: portFreeAfterEscalation,
    escalated: true,
    warnings,
  };
}
