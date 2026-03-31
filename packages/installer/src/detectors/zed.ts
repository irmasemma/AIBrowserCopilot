import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyWrite } from '../installers/config-merger.js';
import { isCommandAvailable, hasExistingMcpEntry } from './utils.js';

const getConfigDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      return join(
        process.env['APPDATA'] ?? join(platform.homeDir, 'AppData', 'Roaming'),
        'Zed',
      );
    case 'macos':
      return join(platform.homeDir, '.config', 'zed');
    case 'linux':
      return join(platform.homeDir, '.config', 'zed');
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

export const getSettingsPath = (platform: PlatformInfo): string =>
  join(getConfigDir(platform), 'settings.json');

export const zedDetector: ToolDetector = {
  name: 'Zed',
  slug: 'zed',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const configDir = getConfigDir(platform);
    const settingsPath = getSettingsPath(platform);
    const dirExists = existsSync(configDir);
    const commandAvailable = isCommandAvailable('zed', platform);

    if (!dirExists && !commandAvailable) {
      return { installed: false };
    }

    const configExists = existsSync(settingsPath);
    return {
      installed: true,
      configPath: settingsPath,
      configExists,
      hasExistingMcp: configExists ? hasExistingMcpEntry(settingsPath) : false,
    };
  },

  async writeConfig(platform: PlatformInfo, binaryPath: string): Promise<WriteConfigResult> {
    const settingsPath = getSettingsPath(platform);
    return mergeConfig(settingsPath, {
      mcp: {
        servers: {
          'ai-browser-copilot': {
            command: binaryPath,
            args: [],
          },
        },
      },
    });
  },

  async verifyConfig(platform: PlatformInfo): Promise<boolean> {
    try {
      verifyWrite(getSettingsPath(platform));
      return true;
    } catch {
      return false;
    }
  },
};
