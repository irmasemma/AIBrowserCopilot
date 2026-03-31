import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPlatform } from '../shared/platform.js';
import { getAssetName, NATIVE_HOST_NAME } from '../shared/constants.js';
import { uninstall } from './uninstaller.js';

const TEST_DIR = join(tmpdir(), `copilot-uninstall-test-${Date.now()}`);

const testPlatform = (os: 'win32' | 'darwin' | 'linux' = 'linux') =>
  detectPlatform(os, 'x64', TEST_DIR);

/**
 * Helper: set up a full installation in test dir (Linux layout).
 * Creates binary, manifest, and Claude Desktop config with MCP entry.
 */
const setupFullInstall = (platform = testPlatform('linux')) => {
  const assetName = getAssetName(platform.os, platform.arch);

  // Binary
  const installDir = join(TEST_DIR, '.local', 'share', 'ai-browser-copilot');
  mkdirSync(installDir, { recursive: true });
  const binaryPath = join(installDir, assetName);
  writeFileSync(binaryPath, 'fake-binary');

  // Manifest
  const manifestDir = join(TEST_DIR, '.config', 'google-chrome', 'NativeMessagingHosts');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, `${NATIVE_HOST_NAME}.json`),
    JSON.stringify({ name: NATIVE_HOST_NAME, type: 'stdio' }),
  );

  // Claude Desktop config with MCP entry
  const claudeDir = join(TEST_DIR, '.config', 'Claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, 'claude_desktop_config.json'),
    JSON.stringify({
      theme: 'dark',
      mcpServers: {
        'ai-browser-copilot': { command: binaryPath, args: [] },
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      },
    }, null, 2) + '\n',
  );

  return { binaryPath, installDir, manifestDir, claudeDir };
};

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('uninstall', () => {
  it('removes binary file', async () => {
    const platform = testPlatform('linux');
    const { binaryPath } = setupFullInstall(platform);

    expect(existsSync(binaryPath)).toBe(true);
    const result = await uninstall(platform);
    expect(result.binaryRemoved).toBe(true);
    expect(existsSync(binaryPath)).toBe(false);
  });

  it('removes empty install directory after binary removal', async () => {
    const platform = testPlatform('linux');
    const { installDir } = setupFullInstall(platform);

    await uninstall(platform);
    expect(existsSync(installDir)).toBe(false);
  });

  it('removes native messaging manifest', async () => {
    const platform = testPlatform('linux');
    const { manifestDir } = setupFullInstall(platform);
    const manifestPath = join(manifestDir, `${NATIVE_HOST_NAME}.json`);

    expect(existsSync(manifestPath)).toBe(true);
    const result = await uninstall(platform);
    expect(result.manifestRemoved).toBe(true);
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('removes ai-browser-copilot from Claude Desktop config', async () => {
    const platform = testPlatform('linux');
    const { claudeDir } = setupFullInstall(platform);
    const configPath = join(claudeDir, 'claude_desktop_config.json');

    const result = await uninstall(platform);
    expect(result.configsRemoved.length).toBeGreaterThan(0);

    const claudeResult = result.configsRemoved.find((c) => c.tool === 'Claude Desktop');
    expect(claudeResult?.removed).toBe(true);
    expect(claudeResult?.backupPath).toBeDefined();

    // Config should still exist but without ai-browser-copilot
    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.mcpServers['ai-browser-copilot']).toBeUndefined();
  });

  it('preserves other MCP entries in config', async () => {
    const platform = testPlatform('linux');
    const { claudeDir } = setupFullInstall(platform);
    const configPath = join(claudeDir, 'claude_desktop_config.json');

    await uninstall(platform);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.theme).toBe('dark');
    expect(updated.mcpServers.filesystem.command).toBe('npx');
  });

  it('succeeds when nothing is installed', async () => {
    const platform = testPlatform('linux');
    // Don't set up anything

    const result = await uninstall(platform);
    expect(result.binaryRemoved).toBe(true);
    expect(result.manifestRemoved).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('succeeds when only binary exists (no configs)', async () => {
    const platform = testPlatform('linux');
    const assetName = getAssetName(platform.os, platform.arch);
    const installDir = join(TEST_DIR, '.local', 'share', 'ai-browser-copilot');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, assetName), 'binary');

    const result = await uninstall(platform);
    expect(result.binaryRemoved).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('removes MCP entry from VS Code settings (mcp.servers format)', async () => {
    const platform = testPlatform('linux');
    setupFullInstall(platform);

    // Also set up VS Code with MCP entry
    const vscodeDir = join(TEST_DIR, '.config', 'Code', 'User');
    mkdirSync(vscodeDir, { recursive: true });
    writeFileSync(
      join(vscodeDir, 'settings.json'),
      JSON.stringify({
        'editor.fontSize': 14,
        mcp: {
          servers: {
            'ai-browser-copilot': { command: '/path' },
            'other-server': { command: 'other' },
          },
        },
      }, null, 2) + '\n',
    );

    const result = await uninstall(platform);

    const vscodeResult = result.configsRemoved.find((c) => c.tool === 'VS Code');
    expect(vscodeResult?.removed).toBe(true);

    const updated = JSON.parse(readFileSync(join(vscodeDir, 'settings.json'), 'utf-8'));
    expect(updated.mcp.servers['ai-browser-copilot']).toBeUndefined();
    expect(updated.mcp.servers['other-server']).toBeDefined();
    expect(updated['editor.fontSize']).toBe(14);
  });

  it('is idempotent — running twice produces no errors', async () => {
    const platform = testPlatform('linux');
    setupFullInstall(platform);

    await uninstall(platform);
    const result2 = await uninstall(platform);

    expect(result2.binaryRemoved).toBe(true);
    expect(result2.manifestRemoved).toBe(true);
    expect(result2.errors).toHaveLength(0);
  });

  it('returns all errors without stopping', async () => {
    const platform = testPlatform('linux');
    // Set up only binary (no manifest or config issues expected)
    setupFullInstall(platform);

    const result = await uninstall(platform);
    // Should complete without throwing, collecting any errors
    expect(result).toBeDefined();
    expect(typeof result.binaryRemoved).toBe('boolean');
    expect(typeof result.manifestRemoved).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('handles macOS paths correctly', async () => {
    const platform = testPlatform('darwin');
    const assetName = getAssetName(platform.os, platform.arch);

    // Set up macOS-style paths
    const installDir = join(TEST_DIR, 'Library', 'Application Support', 'ai-browser-copilot');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, assetName), 'binary');

    const manifestDir = join(TEST_DIR, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, `${NATIVE_HOST_NAME}.json`), '{}');

    const result = await uninstall(platform);
    expect(result.binaryRemoved).toBe(true);
    expect(result.manifestRemoved).toBe(true);
  });
});
