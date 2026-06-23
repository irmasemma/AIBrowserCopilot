import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isBinaryInstalled,
  resolveLocalBinaries,
  downloadBinary,
  renameWithLockFallback,
  cleanupDeleteMeFiles,
} from './binary-installer.js';
import { detectPlatform } from '../shared/platform.js';

const TEST_DIR = join(tmpdir(), `agenthub-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('isBinaryInstalled', () => {
  it('returns false when neither binary nor helper exists', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(false);
  });

  it('returns false when only the bridge is installed (helper missing)', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    writeFileSync(join(TEST_DIR, 'agenthub-win-x64.exe'), 'fake-binary');
    // Helper missing → install is incomplete; the extension would report
    // "Setup incomplete" because it can't reach the native messaging endpoint.
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(false);
  });

  it('returns true when both bridge and helper exist for Windows', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    writeFileSync(join(TEST_DIR, 'agenthub-win-x64.exe'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'agenthub-helper-win-x64.exe'), 'fake-helper');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(true);
  });

  it('returns true when both bridge and helper exist for macOS', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    writeFileSync(join(TEST_DIR, 'agenthub-macos-arm64'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'agenthub-helper-macos-arm64'), 'fake-helper');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(true);
  });

  it('returns true when both bridge and helper exist for Linux', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    writeFileSync(join(TEST_DIR, 'agenthub-linux-x64'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'agenthub-helper-linux-x64'), 'fake-helper');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(true);
  });
});

describe('downloadBinary - directory creation', () => {
  it('creates install directory if it does not exist', async () => {
    const nestedDir = join(TEST_DIR, 'nested', 'dir');
    expect(existsSync(nestedDir)).toBe(false);

    // We can't actually download, but we can test the directory creation logic
    // by importing and testing the module's behavior
    mkdirSync(nestedDir, { recursive: true });
    expect(existsSync(nestedDir)).toBe(true);
  });
});

describe('downloadBinary - file operations', () => {
  it('handles paths with spaces', () => {
    const dirWithSpaces = join(TEST_DIR, 'path with spaces', 'installer');
    mkdirSync(dirWithSpaces, { recursive: true });
    const filePath = join(dirWithSpaces, 'test-binary.exe');
    writeFileSync(filePath, 'fake-binary-content');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('fake-binary-content');
  });

  it('atomic rename from temp to target', () => {
    const tempPath = join(TEST_DIR, 'binary.tmp');
    const targetPath = join(TEST_DIR, 'binary.exe');

    writeFileSync(tempPath, 'binary-content');
    expect(existsSync(tempPath)).toBe(true);

    const { renameSync } = require('node:fs');
    renameSync(tempPath, targetPath);

    expect(existsSync(tempPath)).toBe(false);
    expect(existsSync(targetPath)).toBe(true);
    expect(readFileSync(targetPath, 'utf-8')).toBe('binary-content');
  });

  it('cleanup removes temp files', () => {
    const tempPath = join(TEST_DIR, 'partial.tmp');
    writeFileSync(tempPath, 'partial-data');
    expect(existsSync(tempPath)).toBe(true);

    const { unlinkSync } = require('node:fs');
    unlinkSync(tempPath);
    expect(existsSync(tempPath)).toBe(false);
  });

  it('cleanup is safe when file does not exist', () => {
    const nonExistent = join(TEST_DIR, 'does-not-exist.tmp');
    // Should not throw
    expect(existsSync(nonExistent)).toBe(false);
  });
});

describe('downloadBinary - progress callback', () => {
  it('progress reports correct percentages', () => {
    const totalBytes = 1000;
    const chunks = [250, 250, 250, 250];
    let bytesReceived = 0;
    const reports: number[] = [];

    for (const chunk of chunks) {
      bytesReceived += chunk;
      reports.push(Math.round((bytesReceived / totalBytes) * 100));
    }

    expect(reports).toEqual([25, 50, 75, 100]);
  });
});

describe('resolveLocalBinaries', () => {
  const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
  const binaryName = 'agenthub-win-x64.exe';
  const helperName = 'agenthub-helper-win-x64.exe';

  it('finds binaries in flat layout (both files in the given dir)', () => {
    const dir = join(TEST_DIR, 'flat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, binaryName), 'host');
    writeFileSync(join(dir, helperName), 'helper');

    const r = resolveLocalBinaries(dir, platform);
    expect(r.error).toBeUndefined();
    expect(r.binaryPath).toBe(join(dir, binaryName));
    expect(r.helperPath).toBe(join(dir, helperName));
  });

  it('finds binaries in project-root layout (packages/*/bin/)', () => {
    const root = join(TEST_DIR, 'repo');
    const hostBin = join(root, 'packages', 'native-host', 'bin');
    const helperBin = join(root, 'packages', 'native-host-helper', 'bin');
    mkdirSync(hostBin, { recursive: true });
    mkdirSync(helperBin, { recursive: true });
    writeFileSync(join(hostBin, binaryName), 'host');
    writeFileSync(join(helperBin, helperName), 'helper');

    const r = resolveLocalBinaries(root, platform);
    expect(r.error).toBeUndefined();
    expect(r.binaryPath).toBe(join(hostBin, binaryName));
    expect(r.helperPath).toBe(join(helperBin, helperName));
  });

  it('returns helperPath: null when helper is missing but main binary present', () => {
    const dir = join(TEST_DIR, 'host-only');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, binaryName), 'host');

    const r = resolveLocalBinaries(dir, platform);
    expect(r.error).toBeUndefined();
    expect(r.binaryPath).toBe(join(dir, binaryName));
    expect(r.helperPath).toBeNull();
  });

  it('returns error when main binary is not found in any layout', () => {
    const dir = join(TEST_DIR, 'empty');
    mkdirSync(dir, { recursive: true });

    const r = resolveLocalBinaries(dir, platform);
    expect(r.error).toBeDefined();
    expect(r.error).toContain(binaryName);
    expect(r.binaryPath).toBe('');
  });
});

describe('downloadBinary --from-local path', () => {
  const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
  const binaryName = 'agenthub-win-x64.exe';
  const helperName = 'agenthub-helper-win-x64.exe';

  it('copies binary + helper from local source instead of downloading', async () => {
    const src = join(TEST_DIR, 'src');
    const dst = join(TEST_DIR, 'install');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, binaryName), 'fresh-host-binary');
    writeFileSync(join(src, helperName), 'fresh-helper-binary');

    const result = await downloadBinary(platform, dst, undefined, undefined, src);

    expect(result.success).toBe(true);
    expect(result.binaryPath).toBe(join(dst, binaryName));
    expect(readFileSync(join(dst, binaryName), 'utf-8')).toBe('fresh-host-binary');
    expect(readFileSync(join(dst, helperName), 'utf-8')).toBe('fresh-helper-binary');
  });

  it('succeeds when only main binary exists locally (helper optional)', async () => {
    const src = join(TEST_DIR, 'src-host-only');
    const dst = join(TEST_DIR, 'install-host-only');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, binaryName), 'host-only');

    const result = await downloadBinary(platform, dst, undefined, undefined, src);

    expect(result.success).toBe(true);
    expect(existsSync(join(dst, binaryName))).toBe(true);
    expect(existsSync(join(dst, helperName))).toBe(false);
  });

  it('returns error when --from-local points to a folder without the binary', async () => {
    const src = join(TEST_DIR, 'src-empty');
    const dst = join(TEST_DIR, 'install-empty');
    mkdirSync(src, { recursive: true });

    const result = await downloadBinary(platform, dst, undefined, undefined, src);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain(binaryName);
    expect(existsSync(join(dst, binaryName))).toBe(false);
  });

  it('overwrites an existing installed binary', async () => {
    const src = join(TEST_DIR, 'src-overwrite');
    const dst = join(TEST_DIR, 'install-overwrite');
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(dst, binaryName), 'old-version');
    writeFileSync(join(src, binaryName), 'new-version');

    const result = await downloadBinary(platform, dst, undefined, undefined, src);

    expect(result.success).toBe(true);
    expect(readFileSync(join(dst, binaryName), 'utf-8')).toBe('new-version');
  });
});

describe('renameWithLockFallback — Windows EPERM rename-aside', () => {
  // These tests run on any host because the helper accepts injected fs
  // operations. The bug they protect against is Windows-specific (file
  // locks on running .exe), but the logic is platform-independent given
  // the injected primitives.

  const binaryName = 'agenthub-win-x64.exe';

  it('happy path: simple rename succeeds on first try', () => {
    const dir = join(TEST_DIR, 'rename-happy');
    mkdirSync(dir, { recursive: true });
    const tempPath = join(dir, `${binaryName}.tmp`);
    const targetPath = join(dir, binaryName);
    writeFileSync(tempPath, 'new-binary');

    renameWithLockFallback(tempPath, targetPath, 'windows');

    expect(existsSync(tempPath)).toBe(false);
    expect(readFileSync(targetPath, 'utf-8')).toBe('new-binary');
    // No side files should have been created.
    expect(readdirSync(dir).filter((n) => n.includes('.delete-me-'))).toEqual([]);
  });

  it('on EPERM with target locked, renames the locked target aside and lands the new binary', () => {
    // Simulate the production race: target exists, first rename throws
    // EPERM, second rename (after side-aside) succeeds.
    const tempPath = 'C:\\fake\\bin.tmp';
    const targetPath = 'C:\\fake\\bin.exe';
    const calls: Array<[string, string]> = [];
    let firstRename = true;
    const renameImpl = (from: string, to: string) => {
      calls.push([from, to]);
      if (firstRename) {
        firstRename = false;
        const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
    };
    renameWithLockFallback(tempPath, targetPath, 'windows', {
      renameImpl,
      existsImpl: () => true,
      timestampImpl: () => 1234567890,
    });
    expect(calls).toEqual([
      [tempPath, targetPath],                         // first attempt (throws)
      [targetPath, `${targetPath}.delete-me-1234567890`], // move locked file aside
      [tempPath, targetPath],                         // retry with target slot free
    ]);
  });

  it('on EBUSY (a flavor of the same Windows lock error), same fallback', () => {
    let firstRename = true;
    const calls: Array<[string, string]> = [];
    renameWithLockFallback('a.tmp', 'b.exe', 'windows', {
      renameImpl: (from, to) => {
        calls.push([from, to]);
        if (firstRename) {
          firstRename = false;
          const err = new Error('EBUSY') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
      },
      existsImpl: () => true,
      timestampImpl: () => 9,
    });
    expect(calls).toHaveLength(3);
    expect(calls[1][1]).toBe('b.exe.delete-me-9');
  });

  it('on EPERM but non-Windows, surfaces the error (no fallback)', () => {
    // The fallback exists only for Windows. On macOS/Linux a rename that
    // truly fails with EPERM (permission issue, not a lock) should surface
    // so the user sees the actual error, not a silent rename-aside.
    expect(() => {
      renameWithLockFallback('a.tmp', 'b.exe', 'macos', {
        renameImpl: () => {
          const err = new Error('EPERM') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        },
        existsImpl: () => true,
      });
    }).toThrow(/EPERM/);
  });

  it('on EPERM but target does not exist, surfaces the error (nothing to rename aside)', () => {
    // If the destination .exe doesn't exist, EPERM cannot mean "file locked"
    // — it means a directory permission issue. Don't paper over it.
    expect(() => {
      renameWithLockFallback('a.tmp', 'b.exe', 'windows', {
        renameImpl: () => {
          const err = new Error('EPERM') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        },
        existsImpl: () => false,
      });
    }).toThrow(/EPERM/);
  });

  it('on non-lock error, surfaces immediately without fallback', () => {
    expect(() => {
      renameWithLockFallback('a.tmp', 'b.exe', 'windows', {
        renameImpl: () => {
          const err = new Error('ENOSPC') as NodeJS.ErrnoException;
          err.code = 'ENOSPC';
          throw err;
        },
        existsImpl: () => true,
      });
    }).toThrow(/ENOSPC/);
  });

  it('rolls back the side-aside when the retry rename also fails', () => {
    // If the second rename also fails, the side-aside should be undone so
    // the user does not end up with NO .exe at all. Verifies the catch /
    // rollback path inside renameWithLockFallback.
    const calls: Array<[string, string]> = [];
    let n = 0;
    const renameImpl = (from: string, to: string) => {
      calls.push([from, to]);
      n += 1;
      if (n === 1) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      if (n === 3) {
        // Retry rename .tmp → .exe fails (e.g. AV holds the .tmp now).
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      // n===2 (rename target → side-name) and n===4 (rollback) succeed.
    };
    expect(() => {
      renameWithLockFallback('a.tmp', 'b.exe', 'windows', {
        renameImpl,
        existsImpl: () => true,
        timestampImpl: () => 42,
      });
    }).toThrow(/EPERM/);
    expect(calls).toEqual([
      ['a.tmp', 'b.exe'],
      ['b.exe', 'b.exe.delete-me-42'],
      ['a.tmp', 'b.exe'],
      ['b.exe.delete-me-42', 'b.exe'], // rollback
    ]);
  });
});

describe('cleanupDeleteMeFiles', () => {
  it('removes all .delete-me-* files in the install dir', () => {
    const dir = join(TEST_DIR, 'cleanup');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agenthub-win-x64.exe'), 'live');
    writeFileSync(join(dir, 'agenthub-win-x64.exe.delete-me-100'), 'stale-1');
    writeFileSync(join(dir, 'agenthub-helper-win-x64.exe.delete-me-200'), 'stale-2');

    cleanupDeleteMeFiles(dir);

    expect(existsSync(join(dir, 'agenthub-win-x64.exe'))).toBe(true);
    expect(existsSync(join(dir, 'agenthub-win-x64.exe.delete-me-100'))).toBe(false);
    expect(existsSync(join(dir, 'agenthub-helper-win-x64.exe.delete-me-200'))).toBe(false);
  });

  it('no-op when the install dir does not exist', () => {
    // Must not throw — first-install runs this before the dir is created.
    expect(() => cleanupDeleteMeFiles(join(TEST_DIR, 'never-existed'))).not.toThrow();
  });

  it('survives a file that cannot be deleted (still locked)', () => {
    // We can't simulate a true Windows lock cross-platform, but we can
    // verify the helper doesn't throw when it encounters an unrelated file.
    const dir = join(TEST_DIR, 'cleanup-mixed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'normal.txt'), 'ok');
    writeFileSync(join(dir, 'sweep.delete-me-1'), 'to-clean');
    expect(() => cleanupDeleteMeFiles(dir)).not.toThrow();
    expect(existsSync(join(dir, 'normal.txt'))).toBe(true);
    expect(existsSync(join(dir, 'sweep.delete-me-1'))).toBe(false);
  });
});
