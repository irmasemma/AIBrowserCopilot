import { existsSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { getInstallDir } from '../shared/platform.js';
import { getAssetName, NATIVE_HOST_NAME } from '../shared/constants.js';
import { getManifestPath } from './host-registrar.js';
import { removeConfigEntry } from './config-merger.js';
import { registerAllDetectors, getAll, clear } from '../detectors/index.js';

export interface UninstallResult {
  binaryRemoved: boolean;
  manifestRemoved: boolean;
  registryRemoved: boolean;
  configsRemoved: ConfigRemovalResult[];
  errors: string[];
}

export interface ConfigRemovalResult {
  tool: string;
  removed: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * Remove the native host binary and its install directory (if empty).
 */
const removeBinary = (platform: PlatformInfo): { removed: boolean; error?: string } => {
  const installDir = getInstallDir(platform);
  const assetName = getAssetName(platform.os, platform.arch);
  const binaryPath = join(installDir, assetName);

  try {
    if (existsSync(binaryPath)) {
      unlinkSync(binaryPath);
    }

    // Remove install directory if empty
    if (existsSync(installDir)) {
      const remaining = readdirSync(installDir);
      if (remaining.length === 0) {
        rmSync(installDir, { recursive: true });
      }
    }

    return { removed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { removed: false, error: `Failed to remove binary: ${message}` };
  }
};

/**
 * Remove the native messaging host manifest file.
 */
const removeManifest = (platform: PlatformInfo): { removed: boolean; error?: string } => {
  const manifestPath = getManifestPath(platform);

  try {
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
    }
    return { removed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { removed: false, error: `Failed to remove manifest: ${message}` };
  }
};

/**
 * Remove Windows registry key for native messaging host.
 */
const removeRegistryKey = (platform: PlatformInfo): { removed: boolean; error?: string } => {
  if (platform.os !== 'windows') {
    return { removed: true };
  }

  const regPath = `HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

  try {
    execSync(`reg delete "${regPath}" /f`, { stdio: 'ignore' });
    return { removed: true };
  } catch {
    // Key may not exist — that's fine
    return { removed: true };
  }
};

/**
 * Remove ai-browser-copilot MCP entries from all detected tool configs.
 */
const removeConfigs = async (platform: PlatformInfo): Promise<ConfigRemovalResult[]> => {
  clear();
  registerAllDetectors();
  const detectors = getAll();
  const results: ConfigRemovalResult[] = [];

  for (const detector of detectors) {
    try {
      const detection = await detector.detect(platform);
      if (!detection.configPath || !detection.hasExistingMcp) {
        // No config to clean up
        continue;
      }

      const result = removeConfigEntry(detection.configPath, 'ai-browser-copilot');
      results.push({
        tool: detector.name,
        removed: result.success,
        backupPath: result.backupPath,
        error: result.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ tool: detector.name, removed: false, error: message });
    }
  }

  return results;
};

/**
 * Full uninstall: remove binary, manifest, registry key, and MCP config entries.
 */
export const uninstall = async (platform: PlatformInfo): Promise<UninstallResult> => {
  const errors: string[] = [];

  const binaryResult = removeBinary(platform);
  if (binaryResult.error) errors.push(binaryResult.error);

  const manifestResult = removeManifest(platform);
  if (manifestResult.error) errors.push(manifestResult.error);

  const registryResult = removeRegistryKey(platform);
  if (registryResult.error) errors.push(registryResult.error);

  const configsRemoved = await removeConfigs(platform);
  for (const cr of configsRemoved) {
    if (cr.error) errors.push(`${cr.tool}: ${cr.error}`);
  }

  return {
    binaryRemoved: binaryResult.removed,
    manifestRemoved: manifestResult.removed,
    registryRemoved: registryResult.removed,
    configsRemoved,
    errors,
  };
};
