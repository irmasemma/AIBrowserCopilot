import { existsSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { getInstallDir } from '../shared/platform.js';
import { getAssetName, getHelperAssetName, NATIVE_HOST_NAME } from '../shared/constants.js';
import { getManifestPath } from './host-registrar.js';
import { removeConfigEntry } from './config-merger.js';
import { registerAllDetectors, getAll, clear } from '../detectors/index.js';
import { removeAgentHubFromVscode } from '../detectors/vscode.js';
import { detectBrowsers, HELPER_HOST_NAME } from './browser-registrar.js';
import { killRunningNativeHost, NATIVE_HOST_PORT } from './process-killer.js';
import { unregisterAutostart } from './autostart-registrar.js';

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
 * Remove the native host binaries (bridge + helper) and their install directory
 * if it ends up empty. Both binaries live side-by-side in `%LOCALAPPDATA%\agenthub\`
 * on Windows; missing the helper here leaves a stale .exe behind and prevents
 * the install dir from being garbage-collected.
 */
const removeBinary = (platform: PlatformInfo): { removed: boolean; error?: string } => {
  const installDir = getInstallDir(platform);
  const bridgePath = join(installDir, getAssetName(platform.os, platform.arch));
  const helperPath = join(installDir, getHelperAssetName(platform.os, platform.arch));
  const allowedIdsPath = join(installDir, 'extension-ids.json');

  try {
    for (const p of [bridgePath, helperPath, allowedIdsPath]) {
      if (existsSync(p)) unlinkSync(p);
    }

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
 * Remove the native messaging host manifests. On Windows both the bridge and
 * helper manifests live in the install dir (browser-registrar writes them there
 * and points the per-browser registry keys at them). On macOS/Linux the bridge
 * manifest still lives in the per-browser dir handled by getManifestPath, while
 * the helper manifests are cleaned up by removeMultiBrowserRegistrations.
 */
const removeManifest = (platform: PlatformInfo): { removed: boolean; error?: string } => {
  const paths = [getManifestPath(platform)];
  if (platform.os === 'windows') {
    paths.push(join(getInstallDir(platform), `${HELPER_HOST_NAME}.json`));
  }

  try {
    for (const p of paths) {
      if (existsSync(p)) unlinkSync(p);
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
 * Remove agenthub MCP entries from all detected tool configs.
 */
const removeConfigs = async (platform: PlatformInfo): Promise<ConfigRemovalResult[]> => {
  clear();
  registerAllDetectors();
  const detectors = getAll();
  const results: ConfigRemovalResult[] = [];

  for (const detector of detectors) {
    // VS Code is handled separately below: its uninstall touches both
    // mcp.json (top-level `servers.{key}`, not handled by removeConfigEntry)
    // and legacy settings.json (where the `mcp` block must be pruned even
    // if our entry is already gone, to silence VS Code's deprecation
    // notification).
    if (detector.slug === 'vscode') continue;

    try {
      const detection = await detector.detect(platform);
      if (!detection.configPath || !detection.hasExistingMcp) {
        // No config to clean up
        continue;
      }

      const result = removeConfigEntry(detection.configPath, 'agenthub');
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

  try {
    const vscodeResult = removeAgentHubFromVscode(platform);
    results.push({
      tool: 'VS Code',
      removed: vscodeResult.removed || vscodeResult.errors.length === 0,
      backupPath: vscodeResult.backupPaths[0],
      error: vscodeResult.errors.length > 0 ? vscodeResult.errors.join('; ') : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ tool: 'VS Code', removed: false, error: message });
  }

  return results;
};

/**
 * Remove NM registrations from all detected browsers (main + helper hosts).
 */
const removeMultiBrowserRegistrations = (platform: PlatformInfo): string[] => {
  const errors: string[] = [];
  const browsers = detectBrowsers(platform);

  for (const browser of browsers) {
    const hostNames = [NATIVE_HOST_NAME, HELPER_HOST_NAME];

    for (const hostName of hostNames) {
      try {
        if (platform.os === 'windows' && browser.registryKey) {
          const regPath = `${browser.registryKey}\\${hostName}`;
          try {
            execSync(`reg delete "${regPath}" /f`, { stdio: 'ignore' });
          } catch {
            // Key may not exist
          }
        } else if (browser.manifestDir) {
          const manifestPath = join(browser.manifestDir, `${hostName}.json`);
          if (existsSync(manifestPath)) {
            unlinkSync(manifestPath);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${browser.name}/${hostName}: ${msg}`);
      }
    }
  }

  // Also remove lock file
  const installDir = getInstallDir(platform);
  const lockFile = join(installDir, 'server.lock');
  try {
    if (existsSync(lockFile)) unlinkSync(lockFile);
  } catch {
    // Best effort
  }

  return errors;
};

/**
 * Full uninstall: remove binary, manifest, registry key, and MCP config entries.
 * Also removes NM registrations from all detected browsers.
 */
export const uninstall = async (platform: PlatformInfo): Promise<UninstallResult> => {
  const errors: string[] = [];

  // Stop every running native host first so the .exe files aren't locked
  // when we try to delete them. Pass both image names — multiple bridge
  // instances (one per Chrome profile) and any in-flight helper must all
  // be terminated, not just the port owner. Idempotent.
  const bridgeImage = getAssetName(platform.os, platform.arch);
  const helperImage = getHelperAssetName(platform.os, platform.arch);
  await killRunningNativeHost(platform, NATIVE_HOST_PORT, [bridgeImage, helperImage]);

  // Remove autostart entry so we don't try to relaunch a deleted binary
  // at the user's next login. Best effort — failure is non-fatal.
  try {
    const autostartResult = unregisterAutostart(platform);
    if (!autostartResult.ok && autostartResult.error) {
      errors.push(`Autostart: ${autostartResult.error}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Autostart: ${message}`);
  }

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

  // Remove NM registrations from all browsers (main + helper hosts)
  const browserErrors = removeMultiBrowserRegistrations(platform);
  errors.push(...browserErrors);

  return {
    binaryRemoved: binaryResult.removed,
    manifestRemoved: manifestResult.removed,
    registryRemoved: registryResult.removed,
    configsRemoved,
    errors,
  };
};
