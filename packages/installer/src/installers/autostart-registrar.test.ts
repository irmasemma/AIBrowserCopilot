import { describe, it, expect } from 'vitest';
import {
  registerAutostart,
  unregisterAutostart,
  isAutostartRegistered,
  buildWindowsCommandLine,
  RUN_KEY_NAME,
  HKCU_RUN_PATH,
  type RegistryDriver,
} from './autostart-registrar.js';
import type { PlatformInfo } from '../shared/platform.js';

const windowsPlatform: PlatformInfo = {
  os: 'windows',
  arch: 'x64',
  homeDir: 'C:\\Users\\test',
  isSupported: true,
  displayName: 'Windows x64',
};

const macPlatform: PlatformInfo = {
  os: 'macos',
  arch: 'x64',
  homeDir: '/Users/test',
  isSupported: true,
  displayName: 'macOS x64',
};

function createMockDriver(): RegistryDriver & { writes: Record<string, string>; deletes: string[]; throwOnWrite?: boolean } {
  const state: Record<string, string> = {};
  const driver = {
    writes: state,
    deletes: [] as string[],
    throwOnWrite: false,
    setStringValue(path: string, name: string, value: string) {
      if (driver.throwOnWrite) throw new Error('policy_block');
      state[`${path}\\${name}`] = value;
    },
    deleteValue(path: string, name: string) {
      const key = `${path}\\${name}`;
      driver.deletes.push(key);
      delete state[key];
    },
    getStringValue(path: string, name: string) {
      return state[`${path}\\${name}`] ?? null;
    },
  };
  return driver;
}

describe('autostart-registrar', () => {
  describe('buildWindowsCommandLine', () => {
    it('quotes the binary path and appends --service', () => {
      expect(buildWindowsCommandLine('C:\\Program Files\\foo.exe'))
        .toBe('"C:\\Program Files\\foo.exe" --service');
    });

    it('escapes embedded quotes', () => {
      expect(buildWindowsCommandLine('C:\\path\\with"quote.exe'))
        .toBe('"C:\\path\\with\\"quote.exe" --service');
    });
  });

  describe('registerAutostart', () => {
    it('writes HKCU Run key on Windows', () => {
      const driver = createMockDriver();
      const result = registerAutostart('C:\\copilot.exe', windowsPlatform, { driver });

      expect(result.ok).toBe(true);
      expect(result.method).toBe('hkcu_run');
      expect(driver.writes[`${HKCU_RUN_PATH}\\${RUN_KEY_NAME}`])
        .toBe('"C:\\copilot.exe" --service');
    });

    it('is idempotent — second call overwrites without error', () => {
      const driver = createMockDriver();
      registerAutostart('C:\\old.exe', windowsPlatform, { driver });
      const result = registerAutostart('C:\\new.exe', windowsPlatform, { driver });

      expect(result.ok).toBe(true);
      expect(driver.writes[`${HKCU_RUN_PATH}\\${RUN_KEY_NAME}`])
        .toBe('"C:\\new.exe" --service');
    });

    it('returns method=none on macOS without writing anything', () => {
      const driver = createMockDriver();
      const result = registerAutostart('/path/to/copilot', macPlatform, { driver });

      expect(result.ok).toBe(true);
      expect(result.method).toBe('none');
      expect(Object.keys(driver.writes)).toHaveLength(0);
    });

    it('returns ok=false with error on registry write failure', () => {
      const driver = createMockDriver();
      driver.throwOnWrite = true;
      const result = registerAutostart('C:\\copilot.exe', windowsPlatform, { driver });

      expect(result.ok).toBe(false);
      expect(result.method).toBe('hkcu_run');
      expect(result.error).toContain('policy_block');
    });
  });

  describe('unregisterAutostart', () => {
    it('deletes the HKCU Run key on Windows', () => {
      const driver = createMockDriver();
      registerAutostart('C:\\copilot.exe', windowsPlatform, { driver });
      const result = unregisterAutostart(windowsPlatform, { driver });

      expect(result.ok).toBe(true);
      expect(driver.deletes).toContain(`${HKCU_RUN_PATH}\\${RUN_KEY_NAME}`);
      expect(driver.writes[`${HKCU_RUN_PATH}\\${RUN_KEY_NAME}`]).toBeUndefined();
    });

    it('is idempotent — removing a non-existent key is fine', () => {
      const driver = createMockDriver();
      const result = unregisterAutostart(windowsPlatform, { driver });
      expect(result.ok).toBe(true);
    });

    it('is a no-op on macOS', () => {
      const driver = createMockDriver();
      const result = unregisterAutostart(macPlatform, { driver });
      expect(result.ok).toBe(true);
      expect(result.method).toBe('none');
      expect(driver.deletes).toHaveLength(0);
    });
  });

  describe('isAutostartRegistered', () => {
    it('returns true with the registered command line', () => {
      const driver = createMockDriver();
      registerAutostart('C:\\copilot.exe', windowsPlatform, { driver });
      const status = isAutostartRegistered(windowsPlatform, { driver });

      expect(status.registered).toBe(true);
      expect(status.commandLine).toBe('"C:\\copilot.exe" --service');
    });

    it('returns false when nothing is registered', () => {
      const driver = createMockDriver();
      const status = isAutostartRegistered(windowsPlatform, { driver });
      expect(status.registered).toBe(false);
    });
  });
});
