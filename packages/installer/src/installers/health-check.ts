import { accessSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { getStubAssetName } from '../shared/constants.js';

export interface HealthCheckResult {
  healthy: boolean;
  binaryPath: string;
  error?: string;
}

export const checkBinaryHealth = (
  installDir: string,
  platform: PlatformInfo,
): HealthCheckResult => {
  const assetName = getStubAssetName(platform.os, platform.arch);
  const binaryPath = join(installDir, assetName);

  try {
    // Check file exists and is readable
    accessSync(binaryPath, fsConstants.R_OK);

    // On non-Windows, also check executable permission
    if (platform.os !== 'windows') {
      accessSync(binaryPath, fsConstants.X_OK);
    }

    return { healthy: true, binaryPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      healthy: false,
      binaryPath,
      error: `Health check failed: ${message}`,
    };
  }
};
