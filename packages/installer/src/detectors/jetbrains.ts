import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import { mergeConfig, verifyWrite } from '../installers/config-merger.js';
import { hasExistingMcpEntry } from './utils.js';

/**
 * JetBrains IDEs store MCP config in a shared location.
 * The config dir varies by platform but the MCP config file is the same.
 */
const getConfigDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      return join(
        process.env['APPDATA'] ?? join(platform.homeDir, 'AppData', 'Roaming'),
        'JetBrains',
      );
    case 'macos':
      return join(platform.homeDir, 'Library', 'Application Support', 'JetBrains');
    case 'linux':
      return join(platform.homeDir, '.config', 'JetBrains');
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

/**
 * Check if any JetBrains IDE product directory exists.
 * Product dirs look like: IntelliJIdea2024.3, WebStorm2024.3, PyCharm2024.3, etc.
 */
const hasAnyJetBrainsProduct = (configDir: string): boolean => {
  if (!existsSync(configDir)) return false;

  try {
    const entries = readdirSync(configDir);
    const productPatterns = [
      'IntelliJIdea', 'WebStorm', 'PyCharm', 'PhpStorm', 'GoLand',
      'Rider', 'CLion', 'RubyMine', 'DataGrip', 'RustRover',
    ];
    return entries.some((entry) =>
      productPatterns.some((pattern) => entry.startsWith(pattern)),
    );
  } catch {
    return false;
  }
};

/**
 * JetBrains MCP config is stored at the shared JetBrains config level.
 * Uses the mcp.json file format.
 */
export const getConfigPath = (platform: PlatformInfo): string =>
  join(getConfigDir(platform), 'mcp.json');

export const jetbrainsDetector: ToolDetector = {
  name: 'JetBrains IDE',
  slug: 'jetbrains',

  async detect(platform: PlatformInfo): Promise<DetectionResult> {
    const configDir = getConfigDir(platform);
    const configPath = getConfigPath(platform);

    if (!hasAnyJetBrainsProduct(configDir)) {
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
