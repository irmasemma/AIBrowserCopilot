import { createWriteStream, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync, copyFileSync } from 'node:fs';
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

  // Atomic rename from temp to target
  renameSync(tempPath, targetPath);

  // Set executable permissions on macOS/Linux
  if (platform.os !== 'windows') {
    chmodSync(targetPath, 0o755);
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

  // Stop any running native host so the binary file can be replaced.
  // On Windows the running .exe holds an exclusive lock; without this step
  // a "rerun the installer" flow fails with EPERM/EBUSY on rename.
  if (platform.os === 'windows' && existsSync(targetPath)) {
    const lock = checkBinaryLocked(installDir, platform);
    if (lock.locked) {
      await killRunningNativeHost(platform, NATIVE_HOST_PORT);
    }
  } else {
    // POSIX: a running binary doesn't lock the file, but we still want to
    // free up the port for the freshly installed version.
    await killRunningNativeHost(platform, NATIVE_HOST_PORT);
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

  try {
    copyFileSync(resolved.binaryPath, targetPath);
    if (platform.os !== 'windows') {
      chmodSync(targetPath, 0o755);
    }

    if (resolved.helperPath) {
      copyFileSync(resolved.helperPath, helperTargetPath);
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
