/**
 * Autostart registration for the always-on bridge service.
 *
 * Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run\AIBrowserCopilot
 *          (per-user, no admin required)
 *
 * macOS / Linux: not yet implemented; returns method='none' so the installer
 * can show a "bridge will start on demand" notice without aborting.
 */

import { execFileSync } from 'node:child_process';
import type { PlatformInfo } from '../shared/platform.js';

export const RUN_KEY_NAME = 'AgentHub';
export const HKCU_RUN_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

export type AutostartMethod = 'hkcu_run' | 'launchd' | 'systemd_user' | 'none';

export interface AutostartResult {
  ok: boolean;
  method: AutostartMethod;
  error?: string;
  /** Command line written to the autostart entry. Useful for diagnostics. */
  commandLine?: string;
}

export interface RegistryDriver {
  /** Set a string value at <path>\<name>. Throws on failure. */
  setStringValue(path: string, name: string, value: string): void;
  /** Delete the value <name> from <path>. No-op if missing. Never throws. */
  deleteValue(path: string, name: string): void;
  /** Read the value <name> at <path>, or null if missing. */
  getStringValue(path: string, name: string): string | null;
}

const realRegistryDriver: RegistryDriver = {
  setStringValue(path, name, value) {
    // reg.exe is the official way to write HKCU under Win32 from Node without
    // adding a native module. /f forces overwrite so this is idempotent.
    execFileSync(
      'reg.exe',
      ['add', path, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 },
    );
  },
  deleteValue(path, name) {
    try {
      execFileSync(
        'reg.exe',
        ['delete', path, '/v', name, '/f'],
        { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 },
      );
    } catch {
      // Missing value or missing parent key — fine.
    }
  },
  getStringValue(path, name) {
    try {
      const out = execFileSync(
        'reg.exe',
        ['query', path, '/v', name],
        { encoding: 'utf-8', timeout: 5000 },
      );
      const match = out.match(new RegExp(`${name}\\s+REG_SZ\\s+(.+)`));
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  },
};

export interface RegisterAutostartOptions {
  /** Test seam — defaults to a real reg.exe-backed driver. */
  driver?: RegistryDriver;
}

export function buildWindowsCommandLine(binaryPath: string): string {
  // Always quote the path so spaces in install dirs work (e.g. user with space
  // in name). The `--service` flag is recognised by the bridge entry point and
  // marks `startedBy: 'autostart'` in server_info / lock file.
  const quotedPath = `"${binaryPath.replace(/"/g, '\\"')}"`;
  return `${quotedPath} --service`;
}

export function registerAutostart(
  binaryPath: string,
  platform: PlatformInfo,
  opts: RegisterAutostartOptions = {},
): AutostartResult {
  if (platform.os !== 'windows') {
    return { ok: true, method: 'none' };
  }

  const driver = opts.driver ?? realRegistryDriver;
  const commandLine = buildWindowsCommandLine(binaryPath);

  try {
    driver.setStringValue(HKCU_RUN_PATH, RUN_KEY_NAME, commandLine);
    return { ok: true, method: 'hkcu_run', commandLine };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      method: 'hkcu_run',
      commandLine,
      error: `Failed to write Run key: ${message}`,
    };
  }
}

export function unregisterAutostart(
  platform: PlatformInfo,
  opts: RegisterAutostartOptions = {},
): AutostartResult {
  if (platform.os !== 'windows') {
    return { ok: true, method: 'none' };
  }

  const driver = opts.driver ?? realRegistryDriver;

  try {
    driver.deleteValue(HKCU_RUN_PATH, RUN_KEY_NAME);
    return { ok: true, method: 'hkcu_run' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, method: 'hkcu_run', error: message };
  }
}

export function isAutostartRegistered(
  platform: PlatformInfo,
  opts: RegisterAutostartOptions = {},
): { registered: boolean; commandLine?: string } {
  if (platform.os !== 'windows') return { registered: false };
  const driver = opts.driver ?? realRegistryDriver;
  const value = driver.getStringValue(HKCU_RUN_PATH, RUN_KEY_NAME);
  return value ? { registered: true, commandLine: value } : { registered: false };
}
