import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPlatform } from '../shared/platform.js';
import { getAssetName } from '../shared/constants.js';
import { detectVersion, compareVersions, isOutdated } from './version-detector.js';

const TEST_DIR = join(tmpdir(), `copilot-version-test-${Date.now()}`);

const testPlatform = (os: 'win32' | 'darwin' | 'linux' = 'linux') =>
  detectPlatform(os, 'x64', TEST_DIR);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns -1 when a < b (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns -1 when a < b (minor)', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
  });

  it('returns -1 when a < b (patch)', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
  });

  it('handles different length versions', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });

  it('compares multi-digit versions', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
  });
});

describe('isOutdated', () => {
  it('returns true when installed < latest', () => {
    expect(isOutdated('0.1.0', '0.2.0')).toBe(true);
  });

  it('returns false when installed === latest', () => {
    expect(isOutdated('0.2.0', '0.2.0')).toBe(false);
  });

  it('returns false when installed > latest', () => {
    expect(isOutdated('0.3.0', '0.2.0')).toBe(false);
  });
});

describe('detectVersion', () => {
  it('returns not installed when binary does not exist', () => {
    const platform = testPlatform('linux');
    const result = detectVersion(platform);
    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it('returns installed with error when binary exists but is not executable', () => {
    const platform = testPlatform('linux');
    const installDir = join(TEST_DIR, '.local', 'share', 'ai-browser-copilot');
    mkdirSync(installDir, { recursive: true });

    const assetName = getAssetName(platform.os, platform.arch);
    // Write a non-executable file
    writeFileSync(join(installDir, assetName), 'not-a-binary');

    const result = detectVersion(platform);
    expect(result.installed).toBe(true);
    expect(result.binaryPath).toContain(assetName);
    expect(result.error).toBeDefined();
  });

  it('returns version from a node script that outputs version', () => {
    const platform = testPlatform('linux');
    const installDir = join(TEST_DIR, '.local', 'share', 'ai-browser-copilot');
    mkdirSync(installDir, { recursive: true });

    const assetName = getAssetName(platform.os, platform.arch);
    const binaryPath = join(installDir, assetName);

    // Create a Node.js script that outputs a version
    writeFileSync(binaryPath, '#!/usr/bin/env node\nprocess.stdout.write("0.1.0\\n");\n');
    chmodSync(binaryPath, 0o755);

    // Skip on Windows — can't execute shell scripts directly
    if (process.platform === 'win32') return;

    const result = detectVersion(platform);
    expect(result.installed).toBe(true);
    expect(result.version).toBe('0.1.0');
    expect(result.binaryPath).toBe(binaryPath);
  });
});
