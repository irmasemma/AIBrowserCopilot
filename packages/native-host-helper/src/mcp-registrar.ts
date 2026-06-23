// Self-heal: check whether `agenthub` is registered in Claude Code's config,
// and repair the registration if it's missing. Mirrors the installer's writeConfig
// logic, but kept tiny because it ships inside the native messaging helper bundle.
//
// Why this lives in the helper rather than the installer: the helper is the only
// component that's always present (the installer is a one-shot CLI). The side panel
// already speaks to the helper via Chrome native messaging, so adding two more
// actions is the cheapest way to give the extension a "Re-add" button.

import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform as osPlatform, arch as osArch } from 'node:os';
import { resolveInstallDir } from './install-dir.js';

interface MaybeMcpEntry {
  command?: unknown;
  args?: unknown;
}

export interface CheckMcpResult {
  configExists: boolean;
  configPath: string;
  registered: boolean;
  scope: 'user' | 'project' | null;
  binaryPath: string;
  binaryExists: boolean;
}

export interface RepairMcpResult {
  success: boolean;
  configPath: string;
  binaryPath: string;
  scope: 'user';
  backupPath?: string;
  error?: string;
}

const getClaudeCodeConfigPath = (): string => join(homedir(), '.claude.json');

// Where the installer drops the production binaries. Delegates to the
// shared resolver (honors AGENTHUB_INSTALL_DIR for test isolation, then
// the platform-correct default). Must agree with lock-file-reader.ts /
// service-status.ts / logger.ts so the helper doesn't drift across
// modules.
const getInstallDir = (): string => resolveInstallDir();

const getNativeHostBinaryName = (): string => {
  const arch = osArch();
  switch (osPlatform()) {
    case 'win32':
      return `agenthub-win-${arch === 'arm64' ? 'arm64' : 'x64'}.exe`;
    case 'darwin':
      return `agenthub-macos-${arch === 'arm64' ? 'arm64' : 'x64'}`;
    default:
      return `agenthub-linux-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  }
};

export const getNativeHostBinaryPath = (): string =>
  join(getInstallDir(), getNativeHostBinaryName());

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val);

const detectIndent = (content: string): string => {
  for (const line of content.split('\n')) {
    const m = line.match(/^(\s+)/);
    if (m) return m[1].includes('\t') ? '\t' : ' '.repeat(m[1].length);
  }
  return '  ';
};

const hasEntry = (mcpServers: unknown): boolean => {
  if (!isPlainObject(mcpServers)) return false;
  const entry = (mcpServers as Record<string, MaybeMcpEntry>)['agenthub'];
  return isPlainObject(entry) && typeof (entry as MaybeMcpEntry).command === 'string';
};

export const checkClaudeCodeRegistration = (): CheckMcpResult => {
  const configPath = getClaudeCodeConfigPath();
  const binaryPath = getNativeHostBinaryPath();
  const binaryExists = existsSync(binaryPath);

  if (!existsSync(configPath)) {
    return { configExists: false, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }

  if (!isPlainObject(parsed)) {
    return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }

  // User scope (top-level mcpServers) — the one we want.
  if (hasEntry(parsed.mcpServers)) {
    return { configExists: true, configPath, registered: true, scope: 'user', binaryPath, binaryExists };
  }

  // Project scope (legacy / manual placement). Report it but flag as project so the
  // UI can suggest moving it to user scope.
  const projects = parsed.projects;
  if (isPlainObject(projects)) {
    for (const proj of Object.values(projects)) {
      if (isPlainObject(proj) && hasEntry((proj as Record<string, unknown>).mcpServers)) {
        return { configExists: true, configPath, registered: true, scope: 'project', binaryPath, binaryExists };
      }
    }
  }

  return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
};

const buildBackupPath = (filePath: string): string => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${filePath}.backup-${stamp}`;
};

export const repairClaudeCodeRegistration = (): RepairMcpResult => {
  const configPath = getClaudeCodeConfigPath();
  const binaryPath = getNativeHostBinaryPath();

  if (!existsSync(binaryPath)) {
    return {
      success: false,
      configPath,
      binaryPath,
      scope: 'user',
      error: `Native host binary not found at ${binaryPath}. Run the installer to download it.`,
    };
  }

  // Use the production .exe path as the command. NEVER write a `node .../dist/index.js`
  // dev path here — it would require `node` on PATH and the source build to be present,
  // which is the failure mode that prompted this whole feature.
  const newEntry = {
    command: binaryPath,
    args: [] as string[],
  };

  let existing: Record<string, unknown> = {};
  let raw = '';
  let indentStr = '  ';
  let trailingNewline = true;
  let backupPath: string | undefined;

  if (existsSync(configPath)) {
    raw = readFileSync(configPath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        return {
          success: false,
          configPath,
          binaryPath,
          scope: 'user',
          error: 'Existing config is not a JSON object — refusing to overwrite.',
        };
      }
      existing = parsed;
    } catch (err) {
      return {
        success: false,
        configPath,
        binaryPath,
        scope: 'user',
        error: `Existing config is not valid JSON — refusing to overwrite. ${String(err)}`,
      };
    }
    indentStr = detectIndent(raw);
    trailingNewline = raw.endsWith('\n');

    // Back up before we touch anything.
    backupPath = buildBackupPath(configPath);
    copyFileSync(configPath, backupPath);
  }

  // Always write to USER scope (top-level mcpServers). Project-scope entries are easy
  // for `claude mcp` and Claude Code's own bookkeeping to drop silently.
  const mcpServers = isPlainObject(existing.mcpServers)
    ? { ...(existing.mcpServers as Record<string, unknown>) }
    : {};
  mcpServers['agenthub'] = newEntry;
  const merged = { ...existing, mcpServers };

  let output = JSON.stringify(merged, null, indentStr);
  if (trailingNewline) output += '\n';

  // Atomic write via temp + rename, same pattern as the installer's mergeConfig.
  const tmp = `${configPath}.tmp`;
  writeFileSync(tmp, output, 'utf-8');
  renameSync(tmp, configPath);

  // Verify the entry survived the write.
  const verify = checkClaudeCodeRegistration();
  if (!verify.registered || verify.scope !== 'user') {
    return {
      success: false,
      configPath,
      binaryPath,
      scope: 'user',
      backupPath,
      error: 'Wrote config but post-write verification could not find the entry at user scope.',
    };
  }

  return { success: true, configPath, binaryPath, scope: 'user', backupPath };
};

// Make the install dir resolvable in tests too.
export const _internals = { getInstallDir, getNativeHostBinaryName };
