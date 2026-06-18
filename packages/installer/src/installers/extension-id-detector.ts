import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PlatformInfo } from '../shared/platform.js';

/**
 * Best-effort auto-detection of the AgentHub Chrome extension ID by reading the
 * installed-extensions list out of each Chromium browser profile's preferences.
 *
 * Why this is "best-effort, suggest-don't-trust":
 *   - There can be multiple profiles / multiple browsers, each with its own ID.
 *   - Unpacked (dev) extensions have a path-derived ID that differs per machine;
 *     the Web-Store build has its own fixed ID. Both legitimately exist.
 *   - Browser files may be locked while the browser is running.
 * So the installer SUGGESTS a detected ID (and only auto-uses it under --yes
 * when exactly one is found); it never silently registers an unconfirmed ID.
 *
 * Never throws — any IO/parse error for a given file is skipped.
 */

// Substring (case-insensitive) we look for in an extension's manifest name.
const NAME_MARKER = 'agenthub';

interface ChromiumBrowser {
  /** User Data root, relative to the per-platform base dir. */
  windows: string;
  macos: string;
  linux: string;
}

// User-Data roots for the Chromium-family browsers we register against.
const BROWSERS: ChromiumBrowser[] = [
  { windows: 'Google\\Chrome\\User Data', macos: 'Google/Chrome', linux: 'google-chrome' },
  { windows: 'Microsoft\\Edge\\User Data', macos: 'Microsoft Edge', linux: 'microsoft-edge' },
  { windows: 'BraveSoftware\\Brave-Browser\\User Data', macos: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser' },
  { windows: 'Vivaldi\\User Data', macos: 'Vivaldi', linux: 'vivaldi' },
];

function userDataRoots(platform: PlatformInfo): string[] {
  return BROWSERS.map((b) => {
    switch (platform.os) {
      case 'windows': {
        const base = process.env['LOCALAPPDATA'] ?? join(platform.homeDir, 'AppData', 'Local');
        return join(base, b.windows);
      }
      case 'macos':
        return join(platform.homeDir, 'Library', 'Application Support', b.macos);
      case 'linux':
        return join(platform.homeDir, '.config', b.linux);
      default:
        return '';
    }
  }).filter((p) => p && existsSync(p));
}

function profileDirs(userDataRoot: string): string[] {
  // Chromium profiles are "Default" and "Profile N". Enumerate them defensively.
  try {
    return readdirSync(userDataRoot)
      .filter((name) => name === 'Default' || /^Profile \d+$/.test(name))
      .map((name) => join(userDataRoot, name))
      .filter((dir) => {
        try { return statSync(dir).isDirectory(); } catch { return false; }
      });
  } catch {
    return [];
  }
}

function idsFromPreferencesFile(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const json = JSON.parse(readFileSync(file, 'utf-8')) as {
      extensions?: { settings?: Record<string, { manifest?: { name?: string } }> };
    };
    const settings = json.extensions?.settings;
    if (!settings) return [];
    const hits: string[] = [];
    for (const [id, entry] of Object.entries(settings)) {
      const name = entry?.manifest?.name;
      if (typeof name === 'string' && name.toLowerCase().includes(NAME_MARKER)) {
        // Chromium extension IDs are 32 chars of a–p.
        if (/^[a-p]{32}$/.test(id)) hits.push(id);
      }
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * Scan all Chromium-family profiles for the AgentHub extension and return the
 * unique set of matching extension IDs. Empty array if none found (or on any
 * error). Order is not significant; callers should treat >1 as ambiguous.
 */
export function detectExtensionIds(platform: PlatformInfo): string[] {
  const found = new Set<string>();
  for (const root of userDataRoots(platform)) {
    for (const profile of profileDirs(root)) {
      // Installed-from-store extension settings live in "Secure Preferences";
      // some (esp. unpacked/dev) land in "Preferences". Check both.
      for (const file of ['Secure Preferences', 'Preferences']) {
        for (const id of idsFromPreferencesFile(join(profile, file))) {
          found.add(id);
        }
      }
    }
  }
  return [...found];
}
