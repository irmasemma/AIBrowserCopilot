import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateManifest, getManifestDir, getManifestPath, registerHost } from './host-registrar.js';
import { detectPlatform } from '../shared/platform.js';
import { NATIVE_HOST_NAME, DEFAULT_EXTENSION_ID } from '../shared/constants.js';

const TEST_DIR = join(tmpdir(), `copilot-reg-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('generateManifest', () => {
  it('generates correct manifest with extension ID', () => {
    const manifest = generateManifest('/path/to/binary', 'testextensionid');
    expect(manifest.name).toBe(NATIVE_HOST_NAME);
    expect(manifest.description).toBe('AI Browser CoPilot Native Messaging Host');
    expect(manifest.type).toBe('stdio');
    expect(manifest.allowed_origins).toEqual(['chrome-extension://testextensionid/']);
  });

  it('generates manifest with custom extension ID', () => {
    const manifest = generateManifest('/path/to/binary', 'abcdefghijklmnop');
    expect(manifest.allowed_origins).toEqual(['chrome-extension://abcdefghijklmnop/']);
  });

  it('resolves binary path to absolute', () => {
    const manifest = generateManifest('relative/path/binary', 'testid');
    expect(manifest.path).toMatch(/^[A-Z]:|^\//); // Starts with drive letter or /
  });

  it('uses correct host name', () => {
    const manifest = generateManifest('/path/to/binary', 'testid');
    expect(manifest.name).toBe('com.copilot.native_host');
  });

  it('throws when extension ID is empty', () => {
    expect(() => generateManifest('/path/to/binary', '')).toThrow('Extension ID is required');
  });

  it('throws when extension ID is not provided and DEFAULT_EXTENSION_ID is empty', () => {
    expect(() => generateManifest('/path/to/binary')).toThrow('Extension ID is required');
  });
});

describe('getManifestDir', () => {
  it('returns Windows install directory', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    const dir = getManifestDir(platform);
    expect(dir).toContain('ai-browser-copilot');
  });

  it('returns macOS Chrome NativeMessagingHosts directory', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    const dir = getManifestDir(platform);
    expect(dir).toContain('Library');
    expect(dir).toContain('Google');
    expect(dir).toContain('NativeMessagingHosts');
  });

  it('returns Linux Chrome NativeMessagingHosts directory', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    const dir = getManifestDir(platform);
    expect(dir).toContain('.config');
    expect(dir).toContain('google-chrome');
    expect(dir).toContain('NativeMessagingHosts');
  });
});

describe('getManifestPath', () => {
  it('returns path with host name JSON filename', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    const path = getManifestPath(platform);
    expect(path).toContain('NativeMessagingHosts');
    expect(path).toContain('com.copilot.native_host.json');
  });

  it('returns macOS manifest path', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    const path = getManifestPath(platform);
    expect(path).toContain('NativeMessagingHosts');
    expect(path).toContain('com.copilot.native_host.json');
  });

  it('returns Windows manifest path', () => {
    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    const path = getManifestPath(platform);
    expect(path).toContain('com.copilot.native_host.json');
  });
});

describe('registerHost', () => {
  const TEST_EXT_ID = 'testextensionid123';

  it('writes manifest file to disk', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath = join(TEST_DIR, 'fake-binary');

    const result = await registerHost(platform, binaryPath, TEST_EXT_ID);

    expect(result.success).toBe(true);
    expect(existsSync(result.manifestPath)).toBe(true);

    const written = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
    expect(written.name).toBe(NATIVE_HOST_NAME);
    expect(written.type).toBe('stdio');
    expect(written.allowed_origins).toEqual([`chrome-extension://${TEST_EXT_ID}/`]);
  });

  it('creates manifest directory if it does not exist', async () => {
    const platform = detectPlatform('linux', 'x64', join(TEST_DIR, 'nonexistent'));
    const binaryPath = join(TEST_DIR, 'fake-binary');

    const result = await registerHost(platform, binaryPath, TEST_EXT_ID);
    expect(result.success).toBe(true);
    expect(existsSync(result.manifestPath)).toBe(true);
  });

  it('overwrites existing manifest (idempotent)', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath1 = join(TEST_DIR, 'binary-v1');
    const binaryPath2 = join(TEST_DIR, 'binary-v2');

    await registerHost(platform, binaryPath1, TEST_EXT_ID);
    const result = await registerHost(platform, binaryPath2, TEST_EXT_ID);

    expect(result.success).toBe(true);
    const written = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
    expect(written.path).toContain('binary-v2');
  });

  it('uses custom extension ID when provided', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath = join(TEST_DIR, 'fake-binary');

    const result = await registerHost(platform, binaryPath, 'myextensionid123');

    expect(result.success).toBe(true);
    const written = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
    expect(written.allowed_origins).toEqual(['chrome-extension://myextensionid123/']);
  });

  it('fails when no extension ID provided (prevents corrupt manifests)', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath = join(TEST_DIR, 'fake-binary');

    const result = await registerHost(platform, binaryPath);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Extension ID is required');
  });

  it('returns error when writeFileSync fails', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath = join(TEST_DIR, 'fake-binary');

    const manifestDir = join(TEST_DIR, '.config', 'google-chrome', 'NativeMessagingHosts');
    mkdirSync(manifestDir, { recursive: true });

    // Create a directory where the manifest file should be — writeFileSync will fail on a directory
    const manifestFilePath = join(manifestDir, 'com.copilot.native_host.json');
    mkdirSync(manifestFilePath, { recursive: true });

    const result = await registerHost(platform, binaryPath, TEST_EXT_ID);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Registration failed');
  });

  it('manifest has valid JSON with trailing newline', async () => {
    const platform = detectPlatform('linux', 'x64', TEST_DIR);
    const binaryPath = join(TEST_DIR, 'fake-binary');

    await registerHost(platform, binaryPath, TEST_EXT_ID);

    const manifestPath = getManifestPath(platform);
    const content = readFileSync(manifestPath, 'utf-8');

    expect(() => JSON.parse(content)).not.toThrow();
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('  ');
  });
});
