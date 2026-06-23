import { describe, it, expect } from 'vitest';
import { resolveInstallDir, INSTALL_DIR_ENV_VAR } from './install-dir.js';

/**
 * Behavior contract for resolveInstallDir.
 *
 * Mirror suite lives at packages/native-host-helper/src/install-dir.test.ts.
 * Both copies must assert the same input/output table — when one changes,
 * the other does too. The helper's bundle is independent of the bridge's,
 * but the two MUST agree on where state lives or discovery breaks.
 */

const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('resolveInstallDir', () => {
  it('honors AGENTHUB_INSTALL_DIR on every platform (highest priority)', () => {
    for (const platform of ['win32', 'darwin', 'linux', 'freebsd'] as NodeJS.Platform[]) {
      const dir = resolveInstallDir({
        env: { [INSTALL_DIR_ENV_VAR]: '/tmp/custom-agenthub', LOCALAPPDATA: 'C:\\should-be-ignored' },
        platform,
        homeDir: '/home/test',
      });
      expect(dir, `platform=${platform}`).toBe('/tmp/custom-agenthub');
    }
  });

  it('trims whitespace from the override value', () => {
    const dir = resolveInstallDir({
      env: { [INSTALL_DIR_ENV_VAR]: '   /tmp/with-padding   ' },
      platform: 'linux',
      homeDir: '/home/test',
    });
    expect(dir).toBe('/tmp/with-padding');
  });

  it('treats empty / whitespace-only override as not set and falls through', () => {
    for (const val of ['', '   ', '\t\n']) {
      const dir = resolveInstallDir({
        env: { [INSTALL_DIR_ENV_VAR]: val },
        platform: 'linux',
        homeDir: '/home/test',
      });
      expect(dir, `override=${JSON.stringify(val)}`).toBe('/home/test/.local/share/agenthub');
    }
  });

  it('on Windows: uses %LOCALAPPDATA%\\agenthub when LOCALAPPDATA is set', () => {
    const dir = resolveInstallDir({
      env: { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' },
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
    });
    expect(dir).toBe('C:\\Users\\alice\\AppData\\Local\\agenthub');
  });

  it('on Windows: falls back to homeDir\\AppData\\Local\\agenthub if LOCALAPPDATA is unset', () => {
    const dir = resolveInstallDir({
      env: EMPTY_ENV,
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
    });
    expect(dir).toBe('C:\\Users\\alice\\AppData\\Local\\agenthub');
  });

  it('on macOS: uses ~/Library/Application Support/agenthub', () => {
    const dir = resolveInstallDir({
      env: EMPTY_ENV,
      platform: 'darwin',
      homeDir: '/Users/alice',
    });
    expect(dir).toBe('/Users/alice/Library/Application Support/agenthub');
  });

  it('on Linux: uses ~/.local/share/agenthub', () => {
    const dir = resolveInstallDir({
      env: EMPTY_ENV,
      platform: 'linux',
      homeDir: '/home/alice',
    });
    expect(dir).toBe('/home/alice/.local/share/agenthub');
  });

  it('on other unix-likes: defaults to the Linux path (not the prior ~/.agenthub bug)', () => {
    for (const platform of ['freebsd', 'openbsd', 'sunos', 'aix'] as NodeJS.Platform[]) {
      const dir = resolveInstallDir({
        env: EMPTY_ENV,
        platform,
        homeDir: '/home/alice',
      });
      expect(dir, `platform=${platform}`).toBe('/home/alice/.local/share/agenthub');
    }
  });

  it('uses process defaults when called without opts', () => {
    const dir = resolveInstallDir();
    // Just assert it returned an absolute-ish string ending in agenthub —
    // exact value depends on the host OS. The behavior assertions live
    // in the explicit-opts cases above.
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toMatch(/agenthub$/);
  });
});
