import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyWrite } from '../installers/config-merger.js';
import { hasExistingMcpEntry } from './utils.js';

const CONFIG_FILENAME = 'claude_desktop_config.json';

const getConfigDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      return join(
        process.env['APPDATA'] ?? join(platform.homeDir, 'AppData', 'Roaming'),
        'Claude',
      );
    case 'macos':
      return join(platform.homeDir, 'Library', 'Application Support', 'Claude');
    case 'linux':
      return join(platform.homeDir, '.config', 'Claude');
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

export const getConfigPath = (platform: PlatformInfo): string =>
  join(getConfigDir(platform), CONFIG_FILENAME);

export const claudeDesktopDetector: ToolDetector = {
  name: 'Claude Desktop',
  slug: 'claude-desktop',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const configDir = getConfigDir(platform);
    const configPath = getConfigPath(platform);
    const dirExists = existsSync(configDir);

    if (!dirExists) {
      return { installed: false };
    }

    const configExists = existsSync(configPath);
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
