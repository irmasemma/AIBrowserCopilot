import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyWrite } from '../installers/config-merger.js';
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

  async writeConfig(platform: PlatformInfo, binaryPath: string): Promise<WriteConfigResult> {
    const configPath = getConfigPath(platform);
    return mergeConfig(configPath, {
      mcpServers: {
        'ai-browser-copilot': {
          command: binaryPath,
          args: [],
        },
      },
    });
  },

  async verifyConfig(platform: PlatformInfo): Promise<boolean> {
    try {
      verifyWrite(getConfigPath(platform));
      return true;
    } catch {
      return false;
    }
  },
};
