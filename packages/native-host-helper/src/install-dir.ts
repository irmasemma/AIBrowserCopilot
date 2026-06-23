/**
 * Native-host-helper copy of the install-dir resolver.
 *
 * KEEP IN SYNC with `packages/native-host/src/shared/install-dir.ts`. The
 * helper bundles independently (esbuild → pkg) so cross-package source
 * sharing would force a bundler config change; a small literal duplicate
 * here is the lower-risk choice. Both copies have paired unit tests that
 * assert the same input/output table — when one changes, change the other.
 *
 * Resolution order (first hit wins):
 *   1. `AGENTHUB_INSTALL_DIR` env var (any platform, any non-empty value)
 *   2. Windows: `%LOCALAPPDATA%\agenthub` (or `%USERPROFILE%\AppData\Local\agenthub` if unset)
 *   3. macOS:   `~/Library/Application Support/agenthub`
 *   4. Linux+:  `~/.local/share/agenthub`
 *
 * Historical bug this fixes: `logger.ts` previously returned `~/.agenthub`
 * as the fallback on macOS/Linux (different from every other module's
 * `~/.local/share/agenthub`), so helper.log ended up in a different
 * directory from bridge.log on those platforms. The unified resolver
 * removes the inconsistency.
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
