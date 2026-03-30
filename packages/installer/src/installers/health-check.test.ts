import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBinaryHealth } from './health-check.js';
import { detectPlatform } from '../shared/platform.js';

const TEST_DIR = join(tmpdir(), `copilot-health-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('checkBinaryHealth', () => {
  it('returns healthy when binary exists and is readable', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    writeFileSync(join(TEST_DIR, 'ai-browser-copilot-win-x64.exe'), 'fake-binary');

    const result = checkBinaryHealth(TEST_DIR, platform);
    expect(result.healthy).toBe(true);
    expect(result.binaryPath).toContain('ai-browser-copilot-win-x64.exe');
    expect(result.error).toBeUndefined();
  });

  it('returns unhealthy when binary does not exist', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');

    const result = checkBinaryHealth(TEST_DIR, platform);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('Health check failed');
  });

  it('returns unhealthy when install directory does not exist', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');

    const result = checkBinaryHealth(join(TEST_DIR, 'nonexistent'), platform);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('Health check failed');
  });

  it('returns correct binary path for macOS arm64', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    writeFileSync(join(TEST_DIR, 'ai-browser-copilot-macos-arm64'), 'fake-binary');

    const result = checkBinaryHealth(TEST_DIR, platform);
    expect(result.healthy).toBe(true);
    expect(result.binaryPath).toContain('ai-browser-copilot-macos-arm64');
  });

  it('returns correct binary path for Linux x64', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    writeFileSync(join(TEST_DIR, 'ai-browser-copilot-linux-x64'), 'fake-binary');

    const result = checkBinaryHealth(TEST_DIR, platform);
    expect(result.healthy).toBe(true);
    expect(result.binaryPath).toContain('ai-browser-copilot-linux-x64');
  });

  it('includes binary path in unhealthy result', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');

    const result = checkBinaryHealth(TEST_DIR, platform);
    expect(result.healthy).toBe(false);
    expect(result.binaryPath).toContain('ai-browser-copilot-win-x64.exe');
  });
});
