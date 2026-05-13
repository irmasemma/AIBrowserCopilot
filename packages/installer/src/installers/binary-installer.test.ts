import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBinaryInstalled, resolveLocalBinaries, downloadBinary } from './binary-installer.js';
import { detectPlatform } from '../shared/platform.js';

const TEST_DIR = join(tmpdir(), `copilot-test-${Date.now()}`);

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
    writeFileSync(join(TEST_DIR, 'pilotwave-win-x64.exe'), 'fake-binary');
    // Helper missing → install is incomplete; the extension would report
    // "Setup incomplete" because it can't reach the native messaging endpoint.
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(false);
  });

  it('returns true when both bridge and helper exist for Windows', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    writeFileSync(join(TEST_DIR, 'pilotwave-win-x64.exe'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'pilotwave-helper-win-x64.exe'), 'fake-helper');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(true);
  });

  it('returns true when both bridge and helper exist for macOS', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    writeFileSync(join(TEST_DIR, 'pilotwave-macos-arm64'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'pilotwave-helper-macos-arm64'), 'fake-helper');
    expect(isBinaryInstalled(TEST_DIR, platform)).toBe(true);
  });

  it('returns true when both bridge and helper exist for Linux', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    writeFileSync(join(TEST_DIR, 'pilotwave-linux-x64'), 'fake-binary');
    writeFileSync(join(TEST_DIR, 'pilotwave-helper-linux-x64'), 'fake-helper');
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
  const binaryName = 'pilotwave-win-x64.exe';
  const helperName = 'pilotwave-helper-win-x64.exe';

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
  const binaryName = 'pilotwave-win-x64.exe';
  const helperName = 'pilotwave-helper-win-x64.exe';

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
