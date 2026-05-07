import { createWriteStream, existsSync, mkdirSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { get as httpsGet } from 'node:https';
import { get as httpGet, type IncomingMessage } from 'node:http';
import type { PlatformInfo } from '../shared/platform.js';
import {
  getStubAssetName,
  getStubDownloadUrl,
  getServiceAssetName,
  getServiceDownloadUrl,
} from '../shared/constants.js';
import { withRetry } from '../shared/retry.js';

export interface DownloadProgress {
  bytesReceived: number;
  totalBytes: number;
  percent: number;
  /** Which binary the progress applies to (multiple binaries are downloaded sequentially). */
  asset?: 'stub' | 'service';
}

export interface InstallResult {
  success: boolean;
  /** Path the rest of the installer treats as the "primary" binary — the stub. */
  binaryPath: string;
  /** Path of the long-lived service the stub spawns. */
  servicePath?: string;
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
  asset: 'stub' | 'service' | undefined,
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
          asset,
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

interface SingleDownload {
  url: string;
  targetPath: string;
  tempPath: string;
  asset: 'stub' | 'service';
}

const runSingleDownload = async (
  spec: SingleDownload,
  platform: PlatformInfo,
  onProgress: ((p: DownloadProgress) => void) | undefined,
  onRetry: ((attempt: number, error: Error, delayMs: number) => void) | undefined,
): Promise<number> => {
  let attempts = 0;
  await withRetry(
    async () => {
      attempts++;
      cleanupFile(spec.tempPath);
      await downloadOnce(spec.url, spec.targetPath, spec.tempPath, platform, spec.asset, onProgress);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      onRetry,
    },
  );
  return attempts;
};

/**
 * Kill any running instance of the native host binaries so an upgrade isn't
 * blocked by Windows file locks. Best-effort; safe to call even if nothing is
 * running. Names match all generations: pre-Phase-1 monolithic binary plus
 * the new stub + service binaries.
 */
export const killRunningNativeHosts = (platform: PlatformInfo): { killed: string[]; errors: string[] } => {
  const killed: string[] = [];
  const errors: string[] = [];

  const targets =
    platform.os === 'windows'
      ? [
          // Pre-Phase-1 monolithic binary
          'ai-browser-copilot-win-x64.exe',
          'ai-browser-copilot-win-arm64.exe',
          // Phase 1 stub + service
          'ai-browser-copilot-stub-win-x64.exe',
          'ai-browser-copilot-stub-win-arm64.exe',
          'ai-browser-copilot-service-win-x64.exe',
          'ai-browser-copilot-service-win-arm64.exe',
        ]
      : [
          'ai-browser-copilot-macos-x64',
          'ai-browser-copilot-macos-arm64',
          'ai-browser-copilot-linux-x64',
          'ai-browser-copilot-linux-arm64',
          'ai-browser-copilot-stub-macos-x64',
          'ai-browser-copilot-stub-macos-arm64',
          'ai-browser-copilot-stub-linux-x64',
          'ai-browser-copilot-stub-linux-arm64',
          'ai-browser-copilot-service-macos-x64',
          'ai-browser-copilot-service-macos-arm64',
          'ai-browser-copilot-service-linux-x64',
          'ai-browser-copilot-service-linux-arm64',
        ];

  for (const name of targets) {
    try {
      if (platform.os === 'windows') {
        // taskkill returns 0 only when at least one process was killed.
        // Suppress the "process not found" stderr by routing to ignore.
        execSync(`taskkill /F /IM "${name}"`, { stdio: 'ignore' });
        killed.push(name);
      } else {
        execSync(`pkill -f "${name}"`, { stdio: 'ignore' });
        killed.push(name);
      }
    } catch {
      // Not running — that's fine
    }
  }

  // Give the OS a moment to release file handles before we overwrite binaries.
  if (killed.length > 0 && platform.os === 'windows') {
    const sleepMs = 500;
    const end = Date.now() + sleepMs;
    while (Date.now() < end) { /* spin briefly */ }
  }

  return { killed, errors };
};

/**
 * Phase 1 multi-client: downloads BOTH the stub and the service binaries.
 * The stub is what MCP clients spawn; the service is what the stub auto-spawns
 * on first launch and is the long-lived owner of the WS to the extension.
 *
 * Returns the stub's path as `binaryPath` for back-compat with callers that
 * treated the install as a single binary; `servicePath` is also returned so
 * callers can verify both are present.
 */
export const downloadBinary = async (
  platform: PlatformInfo,
  installDir: string,
  onProgress?: (progress: DownloadProgress) => void,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<InstallResult> => {
  // Create install directory if needed
  if (!existsSync(installDir)) {
    mkdirSync(installDir, { recursive: true });
  }

  // First — kill any running prior-version binaries so we can overwrite them.
  // On Windows, .exe files are file-locked by their running process. The user
  // shouldn't have to taskkill manually before re-running the installer.
  killRunningNativeHosts(platform);

  const stubAsset = getStubAssetName(platform.os, platform.arch);
  const serviceAsset = getServiceAssetName(platform.os, platform.arch);

  const stubSpec: SingleDownload = {
    url: getStubDownloadUrl(platform.os, platform.arch),
    targetPath: join(installDir, stubAsset),
    tempPath: join(installDir, `${stubAsset}.tmp`),
    asset: 'stub',
  };
  const serviceSpec: SingleDownload = {
    url: getServiceDownloadUrl(platform.os, platform.arch),
    targetPath: join(installDir, serviceAsset),
    tempPath: join(installDir, `${serviceAsset}.tmp`),
    asset: 'service',
  };

  let totalAttempts = 0;
  try {
    // Service first — stub depends on its presence at runtime.
    totalAttempts += await runSingleDownload(serviceSpec, platform, onProgress, onRetry);
    totalAttempts += await runSingleDownload(stubSpec, platform, onProgress, onRetry);

    return {
      success: true,
      binaryPath: stubSpec.targetPath,
      servicePath: serviceSpec.targetPath,
      attempts: totalAttempts,
    };
  } catch (err) {
    cleanupFile(stubSpec.tempPath);
    cleanupFile(serviceSpec.tempPath);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      binaryPath: stubSpec.targetPath,
      servicePath: serviceSpec.targetPath,
      error: `Download failed after ${totalAttempts} attempt(s): ${message}`,
      attempts: totalAttempts,
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

/**
 * "Installed" requires both the stub and the service to be present — neither
 * works alone after the multi-client refactor.
 */
export const isBinaryInstalled = (installDir: string, platform: PlatformInfo): boolean => {
  const stubAsset = getStubAssetName(platform.os, platform.arch);
  const serviceAsset = getServiceAssetName(platform.os, platform.arch);
  return existsSync(join(installDir, stubAsset)) && existsSync(join(installDir, serviceAsset));
};

export interface BinaryLockCheck {
  locked: boolean;
  path: string;
  error?: string;
}

/**
 * On Windows, running executables cannot be renamed/deleted. Either binary
 * being locked blocks an in-place upgrade, so check both.
 */
export const checkBinaryLocked = (installDir: string, platform: PlatformInfo): BinaryLockCheck => {
  if (platform.os !== 'windows') {
    return { locked: false, path: installDir };
  }
  for (const asset of [getStubAssetName(platform.os, platform.arch), getServiceAssetName(platform.os, platform.arch)]) {
    const binaryPath = join(installDir, asset);
    if (!existsSync(binaryPath)) continue;
    const testPath = `${binaryPath}.lock-test`;
    try {
      renameSync(binaryPath, testPath);
      renameSync(testPath, binaryPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        return {
          locked: true,
          path: binaryPath,
          error: 'The browser bridge is currently running. Close your AI tool (Claude Code, Cursor, etc.) and try again.',
        };
      }
    }
  }
  return { locked: false, path: installDir };
};
