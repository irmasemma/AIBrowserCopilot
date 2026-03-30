import { homedir } from 'node:os';
import { join } from 'node:path';

export type OsType = 'windows' | 'macos' | 'linux';
export type ArchType = 'x64' | 'arm64';

export interface PlatformInfo {
  os: OsType;
  arch: ArchType;
  homeDir: string;
  isSupported: boolean;
  displayName: string;
}

const OS_MAP: Record<string, OsType> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

const ARCH_MAP: Record<string, ArchType> = {
  x64: 'x64',
  arm64: 'arm64',
};

const OS_DISPLAY: Record<OsType, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export const detectPlatform = (
  platform = process.platform,
  arch = process.arch,
  home = homedir(),
): PlatformInfo => {
  const os = OS_MAP[platform];
  const cpuArch = ARCH_MAP[arch];
  const isSupported = os !== undefined && cpuArch !== undefined;

  return {
    os: os ?? ('unknown' as OsType),
    arch: cpuArch ?? ('unknown' as ArchType),
    homeDir: home,
    isSupported,
    displayName: isSupported
      ? `${OS_DISPLAY[os]} ${cpuArch}`
      : `${platform} ${arch} (unsupported)`,
  };
};

export const getInstallDir = (platform: PlatformInfo): string => {
  switch (platform.os) {
    case 'windows':
      return join(
        process.env['LOCALAPPDATA'] ?? join(platform.homeDir, 'AppData', 'Local'),
        'ai-browser-copilot',
      );
    case 'macos':
      return join(platform.homeDir, 'Library', 'Application Support', 'ai-browser-copilot');
    case 'linux':
      return join(platform.homeDir, '.local', 'share', 'ai-browser-copilot');
    default:
      throw new Error(`Unsupported platform: ${platform.os}`);
  }
};

export const isNodeVersionSupported = (version = process.version): boolean => {
  const match = version.match(/^v?(\d+)/);
  if (!match) return false;
  return parseInt(match[1], 10) >= 18;
};

export const MIN_NODE_VERSION = '18.0.0';
