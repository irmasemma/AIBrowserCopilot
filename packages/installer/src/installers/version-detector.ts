import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { getInstallDir } from '../shared/platform.js';
import { getAssetName } from '../shared/constants.js';

export interface VersionInfo {
  installed: boolean;
  version?: string;
  binaryPath?: string;
  error?: string;
}

/**
 * Detect the installed native host version by running it with --version.
 * Returns the version string or undefined if not installed/detectable.
 */
export const detectVersion = (platform: PlatformInfo): VersionInfo => {
  const installDir = getInstallDir(platform);
  const assetName = getAssetName(platform.os, platform.arch);
  const binaryPath = join(installDir, assetName);

  if (!existsSync(binaryPath)) {
    return { installed: false };
  }

  try {
    const output = execSync(`"${binaryPath}" --version`, {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const version = output.trim();
    if (!version) {
      return { installed: true, binaryPath, error: 'Empty version output' };
    }

    return { installed: true, version, binaryPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { installed: true, binaryPath, error: `Version detection failed: ${message}` };
  }
};

/**
 * Compare two semver-like version strings.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 */
export const compareVersions = (a: string, b: string): number => {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
};

/**
 * Check if the installed version is outdated compared to the latest.
 */
export const isOutdated = (installed: string, latest: string): boolean =>
  compareVersions(installed, latest) < 0;
