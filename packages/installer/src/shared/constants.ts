import type { OsType, ArchType } from './platform.js';

export const GITHUB_REPO = 'irmasemma/AIBrowserCopilot';
export const GITHUB_RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

export const NATIVE_HOST_NAME = 'com.copilot.native_host';
export const NATIVE_HOST_DESCRIPTION = 'AI Browser CoPilot Native Messaging Host';
export const HELPER_HOST_NAME = 'com.copilot.native_host_helper';
export const HELPER_DESCRIPTION = 'AI Browser CoPilot Discovery Helper';
export const BINARY_PREFIX = 'ai-browser-copilot';
export const HELPER_PREFIX = 'ai-browser-copilot-helper';
// No default — must be provided via --extension-id flag
export const DEFAULT_EXTENSION_ID = '';

const ASSET_MAP: Record<string, string> = {
  'windows-x64': `${BINARY_PREFIX}-win-x64.exe`,
  'windows-arm64': `${BINARY_PREFIX}-win-arm64.exe`,
  'macos-x64': `${BINARY_PREFIX}-macos-x64`,
  'macos-arm64': `${BINARY_PREFIX}-macos-arm64`,
  'linux-x64': `${BINARY_PREFIX}-linux-x64`,
  'linux-arm64': `${BINARY_PREFIX}-linux-arm64`,
};

const HELPER_ASSET_MAP: Record<string, string> = {
  'windows-x64': `${HELPER_PREFIX}-win-x64.exe`,
  'windows-arm64': `${HELPER_PREFIX}-win-arm64.exe`,
  'macos-x64': `${HELPER_PREFIX}-macos-x64`,
  'macos-arm64': `${HELPER_PREFIX}-macos-arm64`,
  'linux-x64': `${HELPER_PREFIX}-linux-x64`,
  'linux-arm64': `${HELPER_PREFIX}-linux-arm64`,
};

export const getAssetName = (os: OsType, arch: ArchType): string => {
  const key = `${os}-${arch}`;
  const name = ASSET_MAP[key];
  if (!name) {
    throw new Error(`No binary available for ${os} ${arch}`);
  }
  return name;
};

export const getHelperAssetName = (os: OsType, arch: ArchType): string => {
  const key = `${os}-${arch}`;
  const name = HELPER_ASSET_MAP[key];
  if (!name) {
    throw new Error(`No helper binary available for ${os} ${arch}`);
  }
  return name;
};

export const getDownloadUrl = (os: OsType, arch: ArchType): string =>
  `${GITHUB_RELEASES_BASE}/${getAssetName(os, arch)}`;

export const getHelperDownloadUrl = (os: OsType, arch: ArchType): string =>
  `${GITHUB_RELEASES_BASE}/${getHelperAssetName(os, arch)}`;
