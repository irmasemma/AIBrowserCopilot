import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';
import { NATIVE_HOST_NAME, NATIVE_HOST_DESCRIPTION } from '../shared/constants.js';

export const HELPER_HOST_NAME = 'com.copilot.native_host_helper';
const HELPER_DESCRIPTION = 'AI Browser CoPilot Discovery Helper';

export interface BrowserInfo {
  name: string;
  slug: string;
  installed: boolean;
  registryKey?: string;        // Windows
  manifestDir?: string;        // macOS/Linux
}

export interface MultiRegistrationResult {
  browser: string;
  hostName: string;
  success: boolean;
  manifestPath: string;
  error?: string;
}

// Browser detection configs per platform
interface BrowserConfig {
  name: string;
  slug: string;
  windows: { registryPath: string };
  macos: { manifestDir: string; detectPath: string };
  linux: { manifestDir: string };
}

const BROWSERS: BrowserConfig[] = [
  {
    name: 'Chrome',
    slug: 'chrome',
    windows: { registryPath: 'Google\\Chrome' },
    macos: {
      manifestDir: 'Google/Chrome/NativeMessagingHosts',
      detectPath: '/Applications/Google Chrome.app',
    },
    linux: { manifestDir: '.config/google-chrome/NativeMessagingHosts' },
  },
  {
    name: 'Edge',
    slug: 'edge',
    windows: { registryPath: 'Microsoft\\Edge' },
    macos: {
      manifestDir: 'Microsoft Edge/NativeMessagingHosts',
      detectPath: '/Applications/Microsoft Edge.app',
    },
    linux: { manifestDir: '.config/microsoft-edge/NativeMessagingHosts' },
  },
  {
    name: 'Brave',
    slug: 'brave',
    windows: { registryPath: 'BraveSoftware\\Brave-Browser' },
    macos: {
      manifestDir: 'BraveSoftware/Brave-Browser/NativeMessagingHosts',
      detectPath: '/Applications/Brave Browser.app',
    },
    linux: { manifestDir: '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts' },
  },
  {
    name: 'Arc',
    slug: 'arc',
    windows: { registryPath: '' }, // Arc is macOS-only
    macos: {
      manifestDir: 'Arc/User Data/NativeMessagingHosts',
      detectPath: '/Applications/Arc.app',
    },
    linux: { manifestDir: '' }, // No Linux support
  },
  {
    name: 'Vivaldi',
    slug: 'vivaldi',
    windows: { registryPath: 'Vivaldi' },
    macos: {
      manifestDir: 'Vivaldi/NativeMessagingHosts',
      detectPath: '/Applications/Vivaldi.app',
    },
    linux: { manifestDir: '.config/vivaldi/NativeMessagingHosts' },
  },
];

export function detectBrowsers(platform: PlatformInfo): BrowserInfo[] {
  return BROWSERS.map((browser) => {
    const info: BrowserInfo = { name: browser.name, slug: browser.slug, installed: false };

    switch (platform.os) {
      case 'windows': {
        if (!browser.windows.registryPath) break;
        try {
          execSync(
            `reg query "HKCU\\SOFTWARE\\${browser.windows.registryPath}" /ve 2>nul`,
            { stdio: 'pipe' },
          );
          info.installed = true;
        } catch {
          // Also check program files
          const progFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
          info.installed = existsSync(join(progFiles, browser.name));
        }
        info.registryKey = `HKCU\\SOFTWARE\\${browser.windows.registryPath}\\NativeMessagingHosts`;
        break;
      }
      case 'macos': {
        if (!browser.macos.detectPath) break;
        info.installed = existsSync(browser.macos.detectPath);
        info.manifestDir = join(
          platform.homeDir,
          'Library',
          'Application Support',
          browser.macos.manifestDir,
        );
        break;
      }
      case 'linux': {
        if (!browser.linux.manifestDir) break;
        // Check if browser config directory exists
        const configDir = join(platform.homeDir, browser.linux.manifestDir.replace('/NativeMessagingHosts', ''));
        info.installed = existsSync(configDir);
        info.manifestDir = join(platform.homeDir, browser.linux.manifestDir);
        break;
      }
    }

    return info;
  }).filter((b) => {
    // Filter out browsers that don't apply to this platform
    if (b.slug === 'arc' && platform.os !== 'macos') return false;
    return true;
  });
}

function writeManifest(
  dir: string,
  hostName: string,
  description: string,
  binaryPath: string,
  extensionIds: string[],
): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const manifestPath = join(dir, `${hostName}.json`);
  const manifest = {
    name: hostName,
    description,
    path: resolve(binaryPath),
    type: 'stdio',
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifestPath;
}

function createRegistryKey(
  registryBase: string,
  hostName: string,
  manifestPath: string,
): void {
  const regPath = `${registryBase}\\${hostName}`;
  execSync(
    `reg add "${regPath}" /ve /t REG_SZ /d "${resolve(manifestPath)}" /f`,
    { stdio: 'ignore' },
  );
}

export function registerForBrowser(
  browser: BrowserInfo,
  platform: PlatformInfo,
  hostName: string,
  description: string,
  binaryPath: string,
  extensionIds: string[],
): MultiRegistrationResult {
  try {
    if (platform.os === 'windows') {
      if (!browser.registryKey) {
        return { browser: browser.name, hostName, success: false, manifestPath: '', error: 'No registry path for this browser' };
      }
      // Write manifest to install dir
      const installDir = join(
        process.env['LOCALAPPDATA'] ?? join(platform.homeDir, 'AppData', 'Local'),
        'ai-browser-copilot',
      );
      const manifestPath = writeManifest(installDir, hostName, description, binaryPath, extensionIds);
      createRegistryKey(browser.registryKey, hostName, manifestPath);
      return { browser: browser.name, hostName, success: true, manifestPath };
    } else {
      if (!browser.manifestDir) {
        return { browser: browser.name, hostName, success: false, manifestPath: '', error: 'No manifest dir for this browser' };
      }
      const manifestPath = writeManifest(browser.manifestDir, hostName, description, binaryPath, extensionIds);
      return { browser: browser.name, hostName, success: true, manifestPath };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { browser: browser.name, hostName, success: false, manifestPath: '', error: message };
  }
}

export function registerAllBrowsers(
  platform: PlatformInfo,
  binaryPath: string,
  helperBinaryPath: string,
  extensionIds: string[],
  browserFilter?: string[],
): MultiRegistrationResult[] {
  const browsers = detectBrowsers(platform);
  const filtered = browserFilter
    ? browsers.filter((b) => browserFilter.includes(b.slug))
    : browsers.filter((b) => b.installed);

  const results: MultiRegistrationResult[] = [];

  for (const browser of filtered) {
    // Register main host
    results.push(
      registerForBrowser(browser, platform, NATIVE_HOST_NAME, NATIVE_HOST_DESCRIPTION, binaryPath, extensionIds),
    );
    // Register helper host
    results.push(
      registerForBrowser(browser, platform, HELPER_HOST_NAME, HELPER_DESCRIPTION, helperBinaryPath, extensionIds),
    );
  }

  return results;
}
