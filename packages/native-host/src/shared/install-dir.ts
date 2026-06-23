/**
 * Single source of truth for "where does AgentHub keep its on-disk state?"
 *
 * Resolves the install directory consistently across the bridge and the
 * native-host helper. Honors a cross-platform `AGENTHUB_INSTALL_DIR`
 * environment override for tests and unusual deployments, then falls back
 * to the per-OS default. The override has priority over `LOCALAPPDATA` on
 * Windows so a test can fully isolate state regardless of platform.
 *
 * KEEP IN SYNC with `packages/native-host-helper/src/install-dir.ts` —
 * the helper bundles independently and must resolve identically (paired
 * unit tests in both packages assert the same input/output table).
 *
 * Resolution order (first hit wins):
 *   1. `AGENTHUB_INSTALL_DIR` env var (any platform, any non-empty value)
 *   2. Windows: `%LOCALAPPDATA%\agenthub` (or `%USERPROFILE%\AppData\Local\agenthub` if unset)
 *   3. macOS:   `~/Library/Application Support/agenthub`
 *   4. Linux+:  `~/.local/share/agenthub`
 *
 * Why an env override (not just `LOCALAPPDATA`): the bridge previously
 * honored `LOCALAPPDATA` only on Windows. Tests used `LOCALAPPDATA: <temp>`
 * to isolate state — on macOS/Linux that env var was silently ignored, so
 * the bridge wrote its lock file to the developer's real `~/.local/share/
 * agenthub`, polluting it and never satisfying the test's lock-file poll.
 */

import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface ResolveInstallDirOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export const INSTALL_DIR_ENV_VAR = 'AGENTHUB_INSTALL_DIR';

export function resolveInstallDir(opts: ResolveInstallDirOptions = {}): string {
  const env = opts.env ?? process.env;

  const override = env[INSTALL_DIR_ENV_VAR];
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }

  const plat = opts.platform ?? process.platform;
  const home = opts.homeDir ?? homedir();
  // Use the path module appropriate for the TARGET platform, not the host:
  // calling resolveInstallDir({ platform: 'linux' }) from a Windows test
  // must still produce forward-slash paths. Production call sites use
  // process.platform → process's own path module → behavior unchanged.
  const path = plat === 'win32' ? win32 : posix;

  switch (plat) {
    case 'win32':
      return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'agenthub');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'agenthub');
    default:
      return path.join(home, '.local', 'share', 'agenthub');
  }
}
