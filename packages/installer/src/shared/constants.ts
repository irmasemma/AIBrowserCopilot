import type { OsType, ArchType } from './platform.js';

export const GITHUB_REPO = 'irmasemma/AIBrowserCopilot';
export const GITHUB_RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

export const NATIVE_HOST_NAME = 'com.copilot.native_host';
export const NATIVE_HOST_DESCRIPTION = 'AI Browser CoPilot Native Messaging Host';
export const HELPER_HOST_NAME = 'com.copilot.native_host_helper';
export const HELPER_DESCRIPTION = 'AI Browser CoPilot Discovery Helper';

// Phase 1 multi-client: the monolithic native host has been split into a
// long-lived service (owns the WS to the extension) and a tiny per-MCP-client
// stub (pipes stdio↔IPC to the service). Both binaries get installed; the stub
// is what MCP clients spawn and what Chrome native messaging registers.
export const STUB_PREFIX = 'ai-browser-copilot-stub';
export const SERVICE_PREFIX = 'ai-browser-copilot-service';
export const HELPER_PREFIX = 'ai-browser-copilot-helper';

// No default — must be provided via --extension-id flag
export const DEFAULT_EXTENSION_ID = '';

const STUB_ASSET_MAP: Record<string, string> = {
  'windows-x64': `${STUB_PREFIX}-win-x64.exe`,
  'windows-arm64': `${STUB_PREFIX}-win-arm64.exe`,
  'macos-x64': `${STUB_PREFIX}-macos-x64`,
  'macos-arm64': `${STUB_PREFIX}-macos-arm64`,
  'linux-x64': `${STUB_PREFIX}-linux-x64`,
  'linux-arm64': `${STUB_PREFIX}-linux-arm64`,
};

const SERVICE_ASSET_MAP: Record<string, string> = {
  'windows-x64': `${SERVICE_PREFIX}-win-x64.exe`,
  'windows-arm64': `${SERVICE_PREFIX}-win-arm64.exe`,
  'macos-x64': `${SERVICE_PREFIX}-macos-x64`,
  'macos-arm64': `${SERVICE_PREFIX}-macos-arm64`,
  'linux-x64': `${SERVICE_PREFIX}-linux-x64`,
  'linux-arm64': `${SERVICE_PREFIX}-linux-arm64`,
};

const HELPER_ASSET_MAP: Record<string, string> = {
  'windows-x64': `${HELPER_PREFIX}-win-x64.exe`,
  'windows-arm64': `${HELPER_PREFIX}-win-arm64.exe`,
  'macos-x64': `${HELPER_PREFIX}-macos-x64`,
  'macos-arm64': `${HELPER_PREFIX}-macos-arm64`,
  'linux-x64': `${HELPER_PREFIX}-linux-x64`,
  'linux-arm64': `${HELPER_PREFIX}-linux-arm64`,
};

export const getStubAssetName = (os: OsType, arch: ArchType): string => {
  const key = `${os}-${arch}`;
  const name = STUB_ASSET_MAP[key];
  if (!name) {
    throw new Error(`No stub binary available for ${os} ${arch}`);
  }
  return name;
};

export const getServiceAssetName = (os: OsType, arch: ArchType): string => {
  const key = `${os}-${arch}`;
  const name = SERVICE_ASSET_MAP[key];
  if (!name) {
    throw new Error(`No service binary available for ${os} ${arch}`);
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

export const getStubDownloadUrl = (os: OsType, arch: ArchType): string =>
  `${GITHUB_RELEASES_BASE}/${getStubAssetName(os, arch)}`;

export const getServiceDownloadUrl = (os: OsType, arch: ArchType): string =>
  `${GITHUB_RELEASES_BASE}/${getServiceAssetName(os, arch)}`;

export const getHelperDownloadUrl = (os: OsType, arch: ArchType): string =>
  `${GITHUB_RELEASES_BASE}/${getHelperAssetName(os, arch)}`;
