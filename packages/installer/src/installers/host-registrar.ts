import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { NATIVE_HOST_NAME, NATIVE_HOST_DESCRIPTION, DEFAULT_EXTENSION_ID } from '../shared/constants.js';

export interface NativeManifest {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

export interface RegistrationResult {
  success: boolean;
  manifestPath: string;
  error?: string;
}

export const generateManifest = (
  binaryPath: string,
  extensionId?: string,
): NativeManifest => {
  const id = extensionId || DEFAULT_EXTENSION_ID;
  if (!id) {
    throw new Error('Extension ID is required — cannot generate manifest with empty allowed_origins');
  }
  return {
    name: NATIVE_HOST_NAME,
    description: NATIVE_HOST_DESCRIPTION,
    path: resolve(binaryPath),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
};

export const getManifestDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      // On Windows, manifest goes in the same install directory as the binary
      return join(
        process.env['LOCALAPPDATA'] ?? join(platform.homeDir, 'AppData', 'Local'),
        'ai-browser-copilot',
      );
    case 'macos':
      return join(
        platform.homeDir,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'NativeMessagingHosts',
      );
    case 'linux':
      return join(
        platform.homeDir,
        '.config',
        'google-chrome',
        'NativeMessagingHosts',
      );
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

export const getManifestPath = (platform: PlatformInfo): string => {
  return join(getManifestDir(platform), `${NATIVE_HOST_NAME}.json`);
};

const createWindowsRegistryKey = (manifestPath: string): void => {
  const regPath = `HKCU\\SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
  execSync(
    `reg add "${regPath}" /ve /t REG_SZ /d "${resolve(manifestPath)}" /f`,
    { stdio: 'ignore' },
  );
};

export const registerHost = async (
  platform: PlatformInfo,
  binaryPath: string,
  extensionId?: string,
): Promise<RegistrationResult> => {
  const manifestDir = getManifestDir(platform);
  const manifestPath = getManifestPath(platform);

  try {
    // Create manifest directory if needed
    if (!existsSync(manifestDir)) {
      mkdirSync(manifestDir, { recursive: true });
    }

    // Generate and write manifest
    const manifest = generateManifest(binaryPath, extensionId);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    // On Windows, also create registry key
    if (platform.os === 'windows') {
      createWindowsRegistryKey(manifestPath);
    }

    return { success: true, manifestPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      manifestPath,
      error: `Registration failed: ${message}`,
    };
  }
};
