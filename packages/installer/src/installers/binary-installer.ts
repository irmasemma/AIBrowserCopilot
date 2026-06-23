import { createWriteStream, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { get as httpGet, type IncomingMessage } from 'node:http';
import type { PlatformInfo } from '../shared/platform.js';
import { getAssetName, getDownloadUrl, getHelperAssetName, getHelperDownloadUrl } from '../shared/constants.js';
import { withRetry } from '../shared/retry.js';
import { killRunningNativeHost, NATIVE_HOST_PORT } from './process-killer.js';

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number;
  percent: number;
}

export interface InstallResult {
  success: boolean;
  binaryPath: string;
  error?: string;
  attempts?: number;
}

const followRedirects = (
  url: string,
  maxRedirects = 5,
): Promise<IncomingMessage> => {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error('Too many redirects'));
      return;
    }

    const getter = url.startsWith('https:') ? httpsGet : httpGet;
    getter(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        resolve(followRedirects(res.headers.location, maxRedirects - 1));
      } else if (status >= 200 && status < 300) {
        resolve(res);
      } else {
        reject(new Error(`Download failed with status ${status}`));
      }
    }).on('error', reject);
  });
};

const downloadOnce = async (
  url: string,
  targetPath: string,
  tempPath: string,
  platform: PlatformInfo,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> => {
  const res = await followRedirects(url);
  const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(tempPath);
    let bytesReceived = 0;

    res.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (onProgress && totalBytes > 0) {
        onProgress({
          bytesReceived,
          totalBytes,
          percent: Math.round((bytesReceived / totalBytes) * 100),
        });
      }
    });

    res.on('end', () => {
      file.end(() => resolve());
    });

    res.on('error', (err) => {
      file.destroy();
      reject(err);
    });

    file.on('error', (err) => {
      res.destroy();
      reject(err);
    });

    res.pipe(file);
  });

  // Atomic rename from temp to target — with Windows lock fallback.
  renameWithLockFallback(tempPath, targetPath, platform.os);

  // Set executable permissions on macOS/Linux
  if (platform.os !== 'windows') {
    chmodSync(targetPath, 0o755);
  }
};

export interface RenameWithLockFallbackOptions {
  /** Test seam — override the underlying rename. */
  renameImpl?: (from: string, to: string) => void;
  /** Test seam — override the existence check on `targetPath`. */
  existsImpl?: (path: string) => boolean;
  /** Test seam — override the timestamp suffix for deterministic asserts. */
  timestampImpl?: () => number;
}

/**
 * Rename `tempPath` over `targetPath` with Windows lock-aside fallback.
 *
 * On Windows, if the destination .exe is held open by a running process
 * (Chrome / Edge re-spawned a helper → bridge during our download window —
 * see docs/installer-rename-eperm.md for the full race), the rename fails
 * with EPERM/EBUSY/EACCES. The fallback uses Windows' FILE_SHARE_DELETE
 * semantics: a running .exe cannot be deleted-content, but its directory
 * entry can be renamed. We move the locked file out of the way and drop
 * the new binary into the freed-up name. The next install start sweeps
 * up the .delete-me-* files (best-effort).
 *
 * Non-Windows platforms allow overwriting a running binary in place, so the
 * fallback is Windows-only.
 */
export function renameWithLockFallback(
  tempPath: string,
  targetPath: string,
  os: PlatformInfo['os'],
  options: RenameWithLockFallbackOptions = {},
): void {
  const rename = options.renameImpl ?? renameSync;
  const exists = options.existsImpl ?? existsSync;
  const now = options.timestampImpl ?? Date.now;
  try {
    rename(tempPath, targetPath);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const isLockError = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
    if (!isLockError || os !== 'windows' || !exists(targetPath)) {
      throw err;
    }
    const sideName = `${targetPath}.delete-me-${now()}`;
    rename(targetPath, sideName);
    try {
      rename(tempPath, targetPath);
    } catch (retryErr) {
      // Roll back the side-aside so we don't leave the user with no .exe.
      try { rename(sideName, targetPath); } catch { /* nothing more we can do */ }
      throw retryErr;
    }
    // The old .exe is still running from the renamed inode; it will exit
    // when the user closes its driving client, and the leftover file becomes
    // deletable. We don't block on it.
  }
}

/**
 * Best-effort cleanup of leftover `*.delete-me-<timestamp>` files from a
 * prior install that hit the rename-aside path. Runs once per install at
 * the top so we don't accumulate them indefinitely. Files that are still
 * locked (process still running) silently stay; we'll retry next time.
 */
export const cleanupDeleteMeFiles = (installDir: string): void => {
  if (!existsSync(installDir)) return;
  try {
    for (const entry of readdirSync(installDir)) {
      if (!entry.includes('.delete-me-')) continue;
      try {
        unlinkSync(join(installDir, entry));
      } catch {
        // File still locked by a running process — leave it for next time.
      }
    }
  } catch {
    // readdir failure is non-fatal; the installer keeps going.
  }
};

export const downloadBinary = async (
  platform: PlatformInfo,
  installDir: string,
  onProgress?: (progress: DownloadProgress) => void,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
  localSourceDir?: string,
): Promise<InstallResult> => {
  const assetName = getAssetName(platform.os, platform.arch);
  const url = getDownloadUrl(platform.os, platform.arch);
  const targetPath = join(installDir, assetName);
  const tempPath = `${targetPath}.tmp`;

  const helperAsset = getHelperAssetName(platform.os, platform.arch);
  const helperUrl = getHelperDownloadUrl(platform.os, platform.arch);
  const helperTargetPath = join(installDir, helperAsset);
  const helperTempPath = `${helperTargetPath}.tmp`;

  // Create install directory if needed
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }

  // Sweep up any leftover `.delete-me-*` files from a prior install that
  // had to use the rename-aside fallback. Files still locked by a running
  // process are silently skipped and retried on the next install.
  cleanupDeleteMeFiles(installDir);

  // Stop any running native host so the binary file can be replaced.
  // On Windows the running .exe holds an exclusive lock; without this step
  // a "rerun the installer" flow fails with EPERM/EBUSY on rename.
  // Pass both bridge and helper image names so every instance is killed —
  // killing only the port owner misses sibling bridges (one per Chrome
  // profile under multi-profile) and any in-flight helper, and either
  // sibling can still hold a lock on the .exe we need to overwrite.
  // Idempotent: with nothing running this is a cheap tasklist/pgrep no-op.
  if (existsSync(targetPath) || existsSync(helperTargetPath)) {
    await killRunningNativeHost(platform, NATIVE_HOST_PORT, [assetName, helperAsset]);
  }

  // --from-local: skip network, copy from local path
  if (localSourceDir) {
    return installFromLocal(platform, installDir, localSourceDir);
  }

  let attempts = 0;

  try {
    // Main bridge binary
    await withRetry(
      async () => {
        attempts++;
        cleanupFile(tempPath);
        await downloadOnce(url, targetPath, tempPath, platform, onProgress);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        onRetry,
      },
    );

    // Helper binary — Chrome native-messaging endpoint the extension uses for
    // diagnostics (service status, MCP registration check, native-host spawn).
    // Must ship next to the bridge or the side panel reports "Setup incomplete"
    // even after a successful install.
    await withRetry(
      async () => {
        attempts++;
        cleanupFile(helperTempPath);
        await downloadOnce(helperUrl, helperTargetPath, helperTempPath, platform, onProgress);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        onRetry,
      },
    );

    return { success: true, binaryPath: targetPath, attempts };
  } catch (err) {
    // Clean up partial/temp files for both binaries
    cleanupFile(tempPath);
    cleanupFile(helperTempPath);
    // Don't delete targetPath if main binary already succeeded — keep what
    // worked so the user can retry the helper download in isolation later.

    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      binaryPath: targetPath,
      error: `Download failed after ${attempts} attempt(s): ${message}`,
      attempts,
    };
  }
};

const cleanupFile = (path: string): void => {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Best effort cleanup
  }
};

export const isBinaryInstalled = (installDir: string, platform: PlatformInfo): boolean => {
  const assetName = getAssetName(platform.os, platform.arch);
  const helperAsset = getHelperAssetName(platform.os, platform.arch);
  // Both must be present — extension's diagnostics fail without the helper.
  return existsSync(join(installDir, assetName)) && existsSync(join(installDir, helperAsset));
};

export interface LocalBinaryResolution {
  binaryPath: string;
  helperPath: string | null;
  error?: string;
}

/**
 * Resolve local binary paths for --from-local. Supports two layouts:
 *   1. Flat folder: <dir>/<assetName> + <dir>/<helperAssetName>
 *   2. Project root: <dir>/packages/native-host/bin/<assetName> +
 *      <dir>/packages/native-host-helper/bin/<helperAssetName>
 * Helper is optional (returns null if missing — caller decides whether to fail).
 */
export const resolveLocalBinaries = (
  localSourceDir: string,
  platform: PlatformInfo,
): LocalBinaryResolution => {
  const assetName = getAssetName(platform.os, platform.arch);
  const helperAsset = getHelperAssetName(platform.os, platform.arch);

  const layouts = [
    {
      binary: join(localSourceDir, assetName),
      helper: join(localSourceDir, helperAsset),
    },
    {
      binary: join(localSourceDir, 'packages', 'native-host', 'bin', assetName),
      helper: join(localSourceDir, 'packages', 'native-host-helper', 'bin', helperAsset),
    },
  ];

  for (const layout of layouts) {
    if (existsSync(layout.binary)) {
      return {
        binaryPath: layout.binary,
        helperPath: existsSync(layout.helper) ? layout.helper : null,
      };
    }
  }

  return {
    binaryPath: '',
    helperPath: null,
    error:
      `Local binary "${assetName}" not found in "${localSourceDir}". ` +
      `Looked for it directly in the folder and at packages/native-host/bin/${assetName}.`,
  };
};

const installFromLocal = (
  platform: PlatformInfo,
  installDir: string,
  localSourceDir: string,
): InstallResult => {
  const assetName = getAssetName(platform.os, platform.arch);
  const helperAsset = getHelperAssetName(platform.os, platform.arch);
  const targetPath = join(installDir, assetName);
  const helperTargetPath = join(installDir, helperAsset);

  const resolved = resolveLocalBinaries(localSourceDir, platform);
  if (resolved.error) {
    return { success: false, binaryPath: targetPath, error: resolved.error, attempts: 0 };
  }

  // Route the local-install path through the same temp-file + rename-aside
  // fallback the network path uses. Without this, a Windows --from-local
  // install with Chrome/Edge running hits the same EPERM-on-overwrite race
  // (copyFileSync over a locked .exe fails identically to rename over a
  // locked .exe). See docs/installer-rename-eperm.md for the full race.
  const stageAndPlace = (sourcePath: string, finalPath: string): void => {
    const tempPath = `${finalPath}.tmp`;
    if (existsSync(tempPath)) unlinkSync(tempPath);
    copyFileSync(sourcePath, tempPath);
    try {
      renameWithLockFallback(tempPath, finalPath, platform.os);
    } catch (err) {
      try { unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
      throw err;
    }
  };

  try {
    stageAndPlace(resolved.binaryPath, targetPath);
    if (platform.os !== 'windows') {
      chmodSync(targetPath, 0o755);
    }

    if (resolved.helperPath) {
      stageAndPlace(resolved.helperPath, helperTargetPath);
      if (platform.os !== 'windows') {
        chmodSync(helperTargetPath, 0o755);
      }
    }

    return { success: true, binaryPath: targetPath, attempts: 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      binaryPath: targetPath,
      error: `Local install failed: ${message}`,
      attempts: 1,
    };
  }
};

export interface BinaryLockCheck {
  locked: boolean;
  path: string;
  error?: string;
}

/**
 * Check if the binary file is locked (currently running).
 * On Windows, running executables cannot be renamed/deleted.
 * On macOS/Linux, files can be overwritten while running (not locked).
 */
export const checkBinaryLocked = (installDir: string, platform: PlatformInfo): BinaryLockCheck => {
  const assetName = getAssetName(platform.os, platform.arch);
  const binaryPath = join(installDir, assetName);

  if (!existsSync(binaryPath)) {
    return { locked: false, path: binaryPath };
  }

  // Only Windows locks running executables
  if (platform.os !== 'windows') {
    return { locked: false, path: binaryPath };
  }

  // Try a test rename — if it fails with EPERM/EBUSY, file is locked
  const testPath = `${binaryPath}.lock-test`;
  try {
    renameSync(binaryPath, testPath);
    renameSync(testPath, binaryPath); // Rename back
    return { locked: false, path: binaryPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      return {
        locked: true,
        path: binaryPath,
        error: 'The browser bridge is currently running. Close your AI tool (Claude Code, Cursor, etc.) and try again.',
      };
    }
    // Some other error — not a lock
    return { locked: false, path: binaryPath };
  }
};
