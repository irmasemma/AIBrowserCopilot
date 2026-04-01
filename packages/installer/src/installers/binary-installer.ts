import { createWriteStream, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { get as httpGet, type IncomingMessage } from 'node:http';
import type { PlatformInfo } from '../shared/platform.js';
import { getAssetName, getDownloadUrl } from '../shared/constants.js';
import { withRetry } from '../shared/retry.js';

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
): Promise<InstallResult> => {
  const assetName = getAssetName(platform.os, platform.arch);
  const url = getDownloadUrl(platform.os, platform.arch);
  const targetPath = join(installDir, assetName);
  const tempPath = `${targetPath}.tmp`;

  // Create install directory if needed
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }

  let attempts = 0;

  try {
    await withRetry(
      async () => {
        attempts++;
        // Clean up any partial temp file from a previous attempt
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

    return { success: true, binaryPath: targetPath, attempts };
  } catch (err) {
    // Clean up partial/temp files
    cleanupFile(tempPath);
    cleanupFile(targetPath);

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
  return existsSync(join(installDir, assetName));
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
