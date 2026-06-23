/**
 * Detached spawn of the bridge service from the helper.
 *
 * Helper itself is launched by Chrome native messaging — its lifetime is tied
 * to a single request/response. When we spawn the bridge here we MUST detach
 * fully or it will be killed when this helper exits (and Chrome reaps the
 * helper after the response is sent).
 *
 * On Windows: { detached: true, stdio: 'ignore', windowsHide: true } + unref()
 * is documented to break the parent–child link. We additionally do NOT keep
 * any file descriptors shared with the parent.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getBinaryPath } from './service-status.js';

export interface SpawnResult {
  ok: boolean;
  pid?: number;
  alreadyRunning?: boolean;
  error?: string;
  binaryPath: string;
}

export interface SpawnOptions {
  binaryPath?: string;
  /** Test seam — replace child_process.spawn. */
  spawner?: (cmd: string, args: string[], options: object) => Pick<ChildProcess, 'pid' | 'unref'>;
  /** Test seam — replace fs.existsSync. */
  binaryExists?: (path: string) => boolean;
  /** If true, skip the running-bridge probe; useful for unit tests. */
  skipAlreadyRunningCheck?: boolean;
  /** Async predicate: returns true if a healthy bridge already exists. */
  isAlreadyRunning?: () => Promise<boolean>;
}

export async function startNativeHost(opts: SpawnOptions = {}): Promise<SpawnResult> {
  const binaryPath = opts.binaryPath ?? getBinaryPath();
  const exists = (opts.binaryExists ?? existsSync)(binaryPath);
  if (!exists) {
    return { ok: false, error: 'binary_not_found', binaryPath };
  }

  if (!opts.skipAlreadyRunningCheck && opts.isAlreadyRunning) {
    try {
      const running = await opts.isAlreadyRunning();
      if (running) return { ok: true, alreadyRunning: true, binaryPath };
    } catch {
      // Continue — better to try-and-fail than skip silently
    }
  }

  try {
    const spawner = opts.spawner ?? spawn;
    const child = spawner(binaryPath, ['--service'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { ok: true, pid: child.pid ?? undefined, binaryPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), binaryPath };
  }
}
