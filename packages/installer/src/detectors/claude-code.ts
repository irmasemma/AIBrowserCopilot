import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyEntryAtPath } from '../installers/config-merger.js';
import { isCommandAvailable, hasExistingMcpEntry } from './utils.js';

const CONFIG_FILENAME = '.claude.json';

export const getConfigPath = (platform: PlatformInfo): string =>
  join(platform.homeDir, CONFIG_FILENAME);

export const claudeCodeDetector: ToolDetector = {
  name: 'Claude Code',
  slug: 'claude-code',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const configPath = getConfigPath(platform);
    const configExists = existsSync(configPath);
    const commandAvailable = isCommandAvailable('claude', platform);

    if (!configExists && !commandAvailable) {
      return { installed: false };
    }

    return {
      installed: true,
      configPath,
      configExists,
      hasExistingMcp: configExists ? hasExistingMcpEntry(configPath) : false,
    };
  },

  // Always writes to USER scope (top-level mcpServers), never per-project. Reasons:
  // (1) project scope is invisible the moment the user `cd`s elsewhere; (2) `claude mcp`
  // CLI commands and Claude Code's own bookkeeping tend to rewrite the file and can
  // silently drop project-scope entries. User scope is the durable surface.
  // The binaryPath should be the production .exe at %LOCALAPPDATA%/pilotwave/,
  // NOT a dev path like `node .../dist/index.js` — dev paths require a build to be present
  // and `node` to be on PATH, both of which fail on real users' machines.
  async writeConfig(platform: PlatformInfo, binaryPath: string): Promise<WriteConfigResult> {
    const configPath = getConfigPath(platform);
    return mergeConfig(configPath, {
      mcpServers: {
        'pilotwave': {
          command: binaryPath,
          args: [],
        },
      },
    });
  },

  async verifyConfig(platform: PlatformInfo): Promise<boolean> {
    // Verify the *entry* survived, not just that the file is valid JSON. After we
    // write, another process (Claude Code itself, a `claude mcp` invocation, manual
    // edit) can rewrite and drop our entry. Catch that here.
    return verifyEntryAtPath(getConfigPath(platform), ['mcpServers', 'pilotwave']);
  },
};
