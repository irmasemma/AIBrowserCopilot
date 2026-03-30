import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyWrite } from '../installers/config-merger.js';
import { isCommandAvailable, hasExistingMcpEntry } from './utils.js';

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

export const getSettingsPath = (platform: PlatformInfo): string =>
  join(getSettingsDir(platform), 'settings.json');

export const vscodeDetector: ToolDetector = {
  name: 'VS Code',
  slug: 'vscode',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const settingsDir = getSettingsDir(platform);
    const settingsPath = getSettingsPath(platform);
    const dirExists = existsSync(settingsDir);
    const commandAvailable = isCommandAvailable('code', platform);

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
