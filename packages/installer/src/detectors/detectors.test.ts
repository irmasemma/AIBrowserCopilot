import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPlatform } from '../shared/platform.js';
import { claudeDesktopDetector, getConfigPath as getDesktopConfigPath } from './claude-desktop.js';
import { claudeCodeDetector, getConfigPath as getCodeConfigPath } from './claude-code.js';
import { vscodeDetector, getSettingsPath as getVscodeSettingsPath } from './vscode.js';
import { cursorDetector, getSettingsPath as getCursorSettingsPath } from './cursor.js';
import { windsurfDetector, getSettingsPath as getWindsurfSettingsPath } from './windsurf.js';
import { jetbrainsDetector, getConfigPath as getJetbrainsConfigPath } from './jetbrains.js';
import { zedDetector, getSettingsPath as getZedSettingsPath } from './zed.js';
import { continueDevDetector, getConfigPath as getContinueConfigPath } from './continue-dev.js';
import { registerAllDetectors, getAll, clear, runAll } from './index.js';

const TEST_DIR = join(tmpdir(), `copilot-detectors-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  clear();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Helper to create a platform pointing at test dir
const testPlatform = (os: 'win32' | 'darwin' | 'linux' = 'linux') =>
  detectPlatform(os, 'x64', TEST_DIR);

describe('Claude Desktop Detector', () => {
  it('returns not installed when config dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await claudeDesktopDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when config dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'Claude'), { recursive: true });

    const result = await claudeDesktopDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('claude_desktop_config.json');
  });

  it('detects existing config file', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'claude_desktop_config.json'), '{"mcpServers": {}}');

    const result = await claudeDesktopDetector.detect(platform);
    expect(result.configExists).toBe(true);
    expect(result.hasExistingMcp).toBe(false);
  });

  it('detects existing ai-browser-copilot MCP entry', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'claude_desktop_config.json'),
      JSON.stringify({ mcpServers: { 'ai-browser-copilot': { command: 'old' } } }),
    );

    const result = await claudeDesktopDetector.detect(platform);
    expect(result.hasExistingMcp).toBe(true);
  });

  it('writeConfig creates config with mcpServers format', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });

    const result = await claudeDesktopDetector.writeConfig(platform, '/path/to/binary');
    expect(result.success).toBe(true);
    expect(result.action).toBe('created');

    const configPath = getDesktopConfigPath(platform);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/path/to/binary');
  });

  it('writeConfig merges preserving existing entries', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'claude_desktop_config.json');
    writeFileSync(configPath, JSON.stringify({
      theme: 'dark',
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        github: { command: 'gh-mcp', args: [] },
      },
    }, null, 2) + '\n');

    const result = await claudeDesktopDetector.writeConfig(platform, '/path/to/binary');
    expect(result.success).toBe(true);
    expect(result.action).toBe('merged');
    expect(result.backupPath).toBeDefined();

    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.theme).toBe('dark');
    expect(written.mcpServers.filesystem.command).toBe('npx');
    expect(written.mcpServers.github.command).toBe('gh-mcp');
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/path/to/binary');
  });

  it('writeConfig skips malformed JSON', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'claude_desktop_config.json'), '{ broken!!!');

    const result = await claudeDesktopDetector.writeConfig(platform, '/path/to/binary');
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
  });

  it('verifyConfig returns true after valid write', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'Claude');
    mkdirSync(configDir, { recursive: true });

    await claudeDesktopDetector.writeConfig(platform, '/path/to/binary');
    const verified = await claudeDesktopDetector.verifyConfig(platform);
    expect(verified).toBe(true);
  });
});

describe('Claude Code Detector', () => {
  it('returns config path when .claude.json is absent but checks for it', async () => {
    const platform = testPlatform('linux');
    const result = await claudeCodeDetector.detect(platform);
    // If command is available, installed is true even without config
    // If neither file nor command exists, installed is false
    if (result.installed) {
      expect(result.configPath).toContain('.claude.json');
    } else {
      expect(result.installed).toBe(false);
    }
  });

  it('returns installed when .claude.json exists', async () => {
    const platform = testPlatform('linux');
    writeFileSync(join(TEST_DIR, '.claude.json'), '{}');

    const result = await claudeCodeDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('.claude.json');
  });

  it('writeConfig creates .claude.json with mcpServers', async () => {
    const platform = testPlatform('linux');

    const result = await claudeCodeDetector.writeConfig(platform, '/path/to/binary');
    expect(result.success).toBe(true);

    const configPath = getCodeConfigPath(platform);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/path/to/binary');
  });

  it('writeConfig merges into existing .claude.json', async () => {
    const platform = testPlatform('linux');
    writeFileSync(
      join(TEST_DIR, '.claude.json'),
      JSON.stringify({ existingSetting: true, mcpServers: { other: {} } }, null, 2) + '\n',
    );

    const result = await claudeCodeDetector.writeConfig(platform, '/binary');
    expect(result.success).toBe(true);

    const written = JSON.parse(readFileSync(join(TEST_DIR, '.claude.json'), 'utf-8'));
    expect(written.existingSetting).toBe(true);
    expect(written.mcpServers.other).toEqual({});
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/binary');
  });
});

describe('VS Code Detector', () => {
  it('detects based on dir or command availability', async () => {
    const platform = testPlatform('linux');
    const result = await vscodeDetector.detect(platform);
    // If `code` command is available, installed=true even without settings dir
    // Otherwise installed=false
    if (result.installed) {
      expect(result.configPath).toContain('settings.json');
    } else {
      expect(result.installed).toBe(false);
    }
  });

  it('returns installed when settings dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'Code', 'User'), { recursive: true });

    const result = await vscodeDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('settings.json');
  });

  it('uses mcp.servers format (not mcpServers)', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Code', 'User');
    mkdirSync(settingsDir, { recursive: true });

    await vscodeDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written.mcp.servers['ai-browser-copilot']).toBeDefined();
    expect(written.mcpServers).toBeUndefined();
  });

  it('preserves existing VS Code settings during merge', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Code', 'User');
    mkdirSync(settingsDir, { recursive: true });

    const existingSettings: Record<string, unknown> = {
      'editor.fontSize': 14,
      'editor.tabSize': 2,
      'workbench.colorTheme': 'Monokai',
      mcp: { servers: { 'other-tool': { command: 'other' } } },
    };
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(existingSettings, null, 2) + '\n');

    await vscodeDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written['editor.fontSize']).toBe(14);
    expect(written['workbench.colorTheme']).toBe('Monokai');
    expect(written.mcp.servers['other-tool']).toEqual({ command: 'other' });
    expect(written.mcp.servers['ai-browser-copilot'].command).toBe('/binary');
  });

  it('detects existing ai-browser-copilot in mcp.servers', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Code', 'User');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ mcp: { servers: { 'ai-browser-copilot': {} } } }),
    );

    const result = await vscodeDetector.detect(platform);
    expect(result.hasExistingMcp).toBe(true);
  });
});

describe('Cursor Detector', () => {
  it('returns not installed when settings dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await cursorDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when settings dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'Cursor', 'User'), { recursive: true });

    const result = await cursorDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('settings.json');
  });

  it('uses mcp.servers format', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Cursor', 'User');
    mkdirSync(settingsDir, { recursive: true });

    await cursorDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written.mcp.servers['ai-browser-copilot']).toBeDefined();
  });

  it('preserves existing Cursor settings', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Cursor', 'User');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ 'cursor.aiModel': 'gpt-4' }, null, 2) + '\n',
    );

    await cursorDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written['cursor.aiModel']).toBe('gpt-4');
    expect(written.mcp.servers['ai-browser-copilot'].command).toBe('/binary');
  });
});

describe('Windsurf Detector', () => {
  it('returns not installed when settings dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await windsurfDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when settings dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'Windsurf', 'User'), { recursive: true });

    const result = await windsurfDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('settings.json');
  });

  it('uses mcp.servers format', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Windsurf', 'User');
    mkdirSync(settingsDir, { recursive: true });

    await windsurfDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written.mcp.servers['ai-browser-copilot']).toBeDefined();
    expect(written.mcpServers).toBeUndefined();
  });

  it('preserves existing settings during merge', async () => {
    const platform = testPlatform('linux');
    const settingsDir = join(TEST_DIR, '.config', 'Windsurf', 'User');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ 'editor.theme': 'dark' }, null, 2) + '\n',
    );

    await windsurfDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    expect(written['editor.theme']).toBe('dark');
    expect(written.mcp.servers['ai-browser-copilot'].command).toBe('/binary');
  });
});

describe('JetBrains IDE Detector', () => {
  it('returns not installed when config dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await jetbrainsDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns not installed when dir exists but no product dirs', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'JetBrains'), { recursive: true });

    const result = await jetbrainsDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when IntelliJ product dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'JetBrains', 'IntelliJIdea2024.3'), { recursive: true });

    const result = await jetbrainsDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('mcp.json');
  });

  it('returns installed when WebStorm product dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'JetBrains', 'WebStorm2024.3'), { recursive: true });

    const result = await jetbrainsDetector.detect(platform);
    expect(result.installed).toBe(true);
  });

  it('uses mcpServers format', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'JetBrains', 'IntelliJIdea2024.3'), { recursive: true });

    await jetbrainsDetector.writeConfig(platform, '/binary');

    const configPath = getJetbrainsConfigPath(platform);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/binary');
  });

  it('preserves existing entries', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'JetBrains');
    mkdirSync(join(configDir, 'PyCharm2024.3'), { recursive: true });
    writeFileSync(
      join(configDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { existing: { command: 'test' } } }, null, 2) + '\n',
    );

    await jetbrainsDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(configDir, 'mcp.json'), 'utf-8'));
    expect(written.mcpServers.existing.command).toBe('test');
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/binary');
  });
});

describe('Zed Detector', () => {
  it('returns not installed when config dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await zedDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when config dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.config', 'zed'), { recursive: true });

    const result = await zedDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('settings.json');
  });

  it('uses mcp.servers format', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'zed');
    mkdirSync(configDir, { recursive: true });

    await zedDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'));
    expect(written.mcp.servers['ai-browser-copilot']).toBeDefined();
  });

  it('preserves existing settings', async () => {
    const platform = testPlatform('linux');
    const configDir = join(TEST_DIR, '.config', 'zed');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ theme: 'one-dark', vim_mode: true }, null, 2) + '\n',
    );

    await zedDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'));
    expect(written.theme).toBe('one-dark');
    expect(written.vim_mode).toBe(true);
    expect(written.mcp.servers['ai-browser-copilot'].command).toBe('/binary');
  });
});

describe('Continue.dev Detector', () => {
  it('returns not installed when .continue dir missing', async () => {
    const platform = testPlatform('linux');
    const result = await continueDevDetector.detect(platform);
    expect(result.installed).toBe(false);
  });

  it('returns installed when .continue dir exists', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.continue'), { recursive: true });

    const result = await continueDevDetector.detect(platform);
    expect(result.installed).toBe(true);
    expect(result.configPath).toContain('config.json');
  });

  it('uses mcpServers format', async () => {
    const platform = testPlatform('linux');
    mkdirSync(join(TEST_DIR, '.continue'), { recursive: true });

    await continueDevDetector.writeConfig(platform, '/binary');

    const configPath = getContinueConfigPath(platform);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/binary');
  });

  it('preserves existing config', async () => {
    const platform = testPlatform('linux');
    const continueDir = join(TEST_DIR, '.continue');
    mkdirSync(continueDir, { recursive: true });
    writeFileSync(
      join(continueDir, 'config.json'),
      JSON.stringify({
        models: [{ title: 'Claude', provider: 'anthropic' }],
        mcpServers: { existing: { command: 'test' } },
      }, null, 2) + '\n',
    );

    await continueDevDetector.writeConfig(platform, '/binary');

    const written = JSON.parse(readFileSync(join(continueDir, 'config.json'), 'utf-8'));
    expect(written.models).toHaveLength(1);
    expect(written.mcpServers.existing.command).toBe('test');
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('/binary');
  });

  it('detects existing ai-browser-copilot entry', async () => {
    const platform = testPlatform('linux');
    const continueDir = join(TEST_DIR, '.continue');
    mkdirSync(continueDir, { recursive: true });
    writeFileSync(
      join(continueDir, 'config.json'),
      JSON.stringify({ mcpServers: { 'ai-browser-copilot': { command: 'old' } } }),
    );

    const result = await continueDevDetector.detect(platform);
    expect(result.hasExistingMcp).toBe(true);
  });
});

describe('Detector Registry Integration', () => {
  it('registerAllDetectors registers 8 detectors', () => {
    registerAllDetectors();
    expect(getAll()).toHaveLength(8);
  });

  it('all detectors have unique slugs', () => {
    registerAllDetectors();
    const slugs = getAll().map((d) => d.slug);
    expect(new Set(slugs).size).toBe(8);
  });

  it('runAll executes all detectors in parallel', async () => {
    registerAllDetectors();
    const platform = testPlatform('linux');

    const results = await runAll(platform);
    expect(results).toHaveLength(8);

    // None should be installed in test dir
    for (const r of results) {
      expect(r.error).toBeUndefined();
    }
  });
});
