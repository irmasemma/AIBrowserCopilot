import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import {
  createBackup,
  detectIndent,
  verifyEntryAtPath,
  verifyWrite,
  type MergeResult,
} from '../installers/config-merger.js';
import { isCommandAvailable } from './utils.js';

const ENTRY_KEY = 'pilotwave';

const getSettingsDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      return join(
        process.env['APPDATA'] ?? join(platform.homeDir, 'AppData', 'Roaming'),
        'Code',
        'User',
      );
    case 'macos':
      return join(platform.homeDir, 'Library', 'Application Support', 'Code', 'User');
    case 'linux':
      return join(platform.homeDir, '.config', 'Code', 'User');
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

/**
 * Legacy MCP location: VS Code's user settings.json (`mcp.servers.<key>`).
 * VS Code now warns when MCP servers live here. Kept exported for cleanup
 * and migration from older installs.
 */
export const getSettingsPath = (platform: PlatformInfo): string =>
  join(getSettingsDir(platform), 'settings.json');

/**
 * Current MCP location: VS Code's dedicated user mcp.json
 * (`<User>/mcp.json` with top-level `servers.<key>`).
 */
export const getConfigPath = (platform: PlatformInfo): string =>
  join(getSettingsDir(platform), 'mcp.json');

const safeReadJson = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return undefined;
  }
};

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val);

/**
 * Check both the new mcp.json and legacy settings.json locations for an
 * `pilotwave` entry.
 */
const hasExistingVscodeMcp = (platform: PlatformInfo): boolean => {
  const newJson = safeReadJson(getConfigPath(platform));
  if (newJson && isPlainObject(newJson['servers'])) {
    if (ENTRY_KEY in (newJson['servers'] as Record<string, unknown>)) return true;
  }
  const settings = safeReadJson(getSettingsPath(platform));
  if (settings && isPlainObject(settings['mcp'])) {
    const servers = (settings['mcp'] as Record<string, unknown>)['servers'];
    if (isPlainObject(servers) && ENTRY_KEY in servers) return true;
  }
  return false;
};

const atomicWriteJson = (filePath: string, value: unknown, raw?: string): void => {
  const indent = raw ? detectIndent(raw) : { type: 'space' as const, amount: 2 };
  const indentStr = indent.type === 'tab' ? '\t' : ' '.repeat(indent.amount);
  let output = JSON.stringify(value, null, indentStr);
  const trailing = raw ? raw.endsWith('\n') : true;
  if (trailing) output += '\n';
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, output, 'utf-8');
  renameSync(tempPath, filePath);
  verifyWrite(filePath);
};

/**
 * Replace (not deep-merge) the `pilotwave` entry under the top-level
 * `servers` key in mcp.json. Replacing wholesale ensures stale sibling keys
 * (env, disabled, type, etc.) from prior installs are dropped.
 */
const writeMcpJsonEntry = (platform: PlatformInfo, binaryPath: string): WriteConfigResult => {
  const path = getConfigPath(platform);
  const entry = {
    command: binaryPath,
    args: [] as string[],
    type: 'stdio',
  };

  if (!existsSync(path)) {
    const initial = {
      servers: { [ENTRY_KEY]: entry },
      inputs: [] as unknown[],
    };
    atomicWriteJson(path, initial);
    return { success: true, action: 'created' };
  }

  const raw = readFileSync(path, 'utf-8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      success: false,
      action: 'skipped',
      error: `mcp.json contains malformed JSON: ${path}`,
    };
  }

  const backupPath = createBackup(path);

  const servers = isPlainObject(parsed['servers'])
    ? (parsed['servers'] as Record<string, unknown>)
    : {};
  servers[ENTRY_KEY] = entry;
  parsed['servers'] = servers;

  if (!('inputs' in parsed) || !Array.isArray(parsed['inputs'])) {
    parsed['inputs'] = [];
  }

  atomicWriteJson(path, parsed, raw);
  return { success: true, backupPath, action: 'merged' };
};

export interface LegacyCleanupResult {
  cleaned: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * Remove the `pilotwave` entry from VS Code's legacy
 * settings.json `mcp.servers` block, AND prune empty `mcp.servers` /
 * empty `mcp` containers. VS Code emits a deprecation notification
 * whenever `settings.json` contains a `mcp` key — even if its `servers`
 * is empty — so this helper always re-evaluates and rewrites the file
 * if the block can be reduced, regardless of whether the entry was
 * present.
 *
 * Preserves other keys under `mcp` (e.g. `mcp.discovery`,
 * `mcp.gallery.enabled`).
 */
export const cleanupLegacyVscodeSettings = (
  platform: PlatformInfo,
): LegacyCleanupResult => {
  const settingsPath = getSettingsPath(platform);
  if (!existsSync(settingsPath)) return { cleaned: false };

  const raw = readFileSync(settingsPath, 'utf-8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { cleaned: false, error: `settings.json is malformed: ${message}` };
  }

  const mcp = parsed['mcp'];
  if (!isPlainObject(mcp)) return { cleaned: false };

  let modified = false;

  const servers = mcp['servers'];
  if (isPlainObject(servers) && ENTRY_KEY in servers) {
    delete (servers as Record<string, unknown>)[ENTRY_KEY];
    modified = true;
  }

  if (isPlainObject(mcp['servers']) && Object.keys(mcp['servers'] as Record<string, unknown>).length === 0) {
    delete mcp['servers'];
    modified = true;
  }

  if (Object.keys(mcp).length === 0) {
    delete parsed['mcp'];
    modified = true;
  }

  if (!modified) return { cleaned: false };

  const backupPath = createBackup(settingsPath);
  atomicWriteJson(settingsPath, parsed, raw);
  return { cleaned: true, backupPath };
};

/**
 * Remove the `pilotwave` entry from mcp.json. Leaves the file
 * intact (with empty `servers` / `inputs`) so the user's other server
 * registrations are preserved and the file stays valid for VS Code.
 * Idempotent.
 */
const removeMcpJsonEntry = (
  platform: PlatformInfo,
): { removed: boolean; backupPath?: string; error?: string } => {
  const path = getConfigPath(platform);
  if (!existsSync(path)) return { removed: false };

  const raw = readFileSync(path, 'utf-8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { removed: false, error: `mcp.json is malformed: ${message}` };
  }

  const servers = parsed['servers'];
  if (!isPlainObject(servers) || !(ENTRY_KEY in servers)) {
    return { removed: false };
  }

  const backupPath = createBackup(path);
  delete (servers as Record<string, unknown>)[ENTRY_KEY];
  atomicWriteJson(path, parsed, raw);
  return { removed: true, backupPath };
};

export interface VscodeUninstallResult {
  removed: boolean;
  backupPaths: string[];
  errors: string[];
}

/**
 * Full VS Code uninstall: removes the entry from mcp.json AND cleans up
 * the legacy settings.json `mcp` block (entry + empty containers).
 * Idempotent. Used by the uninstaller; not exposed via the generic
 * `removeConfigEntry` path because mcp.json's top-level `servers` shape
 * is VS-Code-specific.
 */
export const removeAiBrowserCopilotFromVscode = (
  platform: PlatformInfo,
): VscodeUninstallResult => {
  const backupPaths: string[] = [];
  const errors: string[] = [];

  const newResult = removeMcpJsonEntry(platform);
  if (newResult.error) errors.push(newResult.error);
  if (newResult.backupPath) backupPaths.push(newResult.backupPath);

  const legacy = cleanupLegacyVscodeSettings(platform);
  if (legacy.error) errors.push(legacy.error);
  if (legacy.backupPath) backupPaths.push(legacy.backupPath);

  return {
    removed: newResult.removed || legacy.cleaned,
    backupPaths,
    errors,
  };
};

export const vscodeDetector: ToolDetector = {
  name: 'VS Code',
  slug: 'vscode',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const settingsDir = getSettingsDir(platform);
    const configPath = getConfigPath(platform);
    const dirExists = existsSync(settingsDir);
    const commandAvailable = isCommandAvailable('code', platform);

    if (!dirExists && !commandAvailable) {
      return { installed: false };
    }

    const configExists = existsSync(configPath);
    return {
      installed: true,
      configPath,
      configExists,
      hasExistingMcp: hasExistingVscodeMcp(platform),
    };
  },

  async writeConfig(platform: PlatformInfo, binaryPath: string): Promise<WriteConfigResult> {
    const writeResult = writeMcpJsonEntry(platform, binaryPath);
    if (!writeResult.success) return writeResult;

    // Migration: prune any leftover pilotwave entry / empty mcp
    // block from settings.json so VS Code stops nagging about
    // user-settings-based MCP config.
    const cleanup = cleanupLegacyVscodeSettings(platform);
    if (cleanup.error) {
      // Don't fail the install — the new entry is in place and functional.
      // Surface the issue so the installer UI can flag it.
      const merged: MergeResult = {
        ...writeResult,
        error: `legacy cleanup: ${cleanup.error}`,
      };
      return merged;
    }
    return writeResult;
  },

  async verifyConfig(platform: PlatformInfo): Promise<boolean> {
    if (!verifyEntryAtPath(getConfigPath(platform), ['servers', ENTRY_KEY])) {
      return false;
    }
    const settings = safeReadJson(getSettingsPath(platform));
    const legacyServers = (settings?.['mcp'] as Record<string, unknown> | undefined)?.[
      'servers'
    ];
    if (isPlainObject(legacyServers) && ENTRY_KEY in legacyServers) {
      return false;
    }
    return true;
  },
};
