import { describe, it, expect } from 'vitest';
import { resolveInstallDir, INSTALL_DIR_ENV_VAR } from './install-dir.js';

/**
 * Mirror suite — same input/output table as
 * `packages/native-host/src/shared/install-dir.test.ts`. Any divergence
 * here means bridge and helper would disagree on where state lives,
 * silently breaking service discovery for whichever side guessed wrong.
 */

const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('resolveInstallDir (helper copy — must match bridge copy)', () => {
  it('honors AGENTHUB_INSTALL_DIR on every platform', () => {
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
    expect(
      resolveInstallDir({
        env: { [INSTALL_DIR_ENV_VAR]: '   /tmp/with-padding   ' },
        platform: 'linux',
        homeDir: '/home/test',
      }),
    ).toBe('/tmp/with-padding');
  });

  it('treats empty / whitespace-only override as not set and falls through', () => {
    for (const val of ['', '   ', '\t\n']) {
      expect(
        resolveInstallDir({
          env: { [INSTALL_DIR_ENV_VAR]: val },
          platform: 'linux',
          homeDir: '/home/test',
        }),
        `override=${JSON.stringify(val)}`,
      ).toBe('/home/test/.local/share/agenthub');
    }
  });

  it('on Windows: uses %LOCALAPPDATA%\\agenthub', () => {
    expect(
      resolveInstallDir({
        env: { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' },
        platform: 'win32',
        homeDir: 'C:\\Users\\alice',
      }),
    ).toBe('C:\\Users\\alice\\AppData\\Local\\agenthub');
  });

  it('on Windows: falls back to homeDir\\AppData\\Local\\agenthub if LOCALAPPDATA is unset', () => {
    expect(
      resolveInstallDir({
        env: EMPTY_ENV,
        platform: 'win32',
        homeDir: 'C:\\Users\\alice',
      }),
    ).toBe('C:\\Users\\alice\\AppData\\Local\\agenthub');
  });

  it('on macOS: uses ~/Library/Application Support/agenthub', () => {
    expect(
      resolveInstallDir({
        env: EMPTY_ENV,
        platform: 'darwin',
        homeDir: '/Users/alice',
      }),
    ).toBe('/Users/alice/Library/Application Support/agenthub');
  });

  it('on Linux: uses ~/.local/share/agenthub', () => {
    expect(
      resolveInstallDir({
        env: EMPTY_ENV,
        platform: 'linux',
        homeDir: '/home/alice',
      }),
    ).toBe('/home/alice/.local/share/agenthub');
  });

  it('on other unix-likes: defaults to the Linux path (not the prior ~/.agenthub bug)', () => {
    for (const platform of ['freebsd', 'openbsd', 'sunos', 'aix'] as NodeJS.Platform[]) {
      expect(
        resolveInstallDir({
          env: EMPTY_ENV,
          platform,
          homeDir: '/home/alice',
        }),
        `platform=${platform}`,
      ).toBe('/home/alice/.local/share/agenthub');
    }
  });
});
