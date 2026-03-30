import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBackup,
  detectIndent,
  deepMerge,
  mergeConfig,
  verifyWrite,
} from './config-merger.js';

const TEST_DIR = join(tmpdir(), `copilot-merger-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('createBackup', () => {
  it('creates a backup with timestamp in filename', () => {
    const filePath = join(TEST_DIR, 'config.json');
    writeFileSync(filePath, '{"key": "value"}');

    const backupPath = createBackup(filePath);
    expect(backupPath).toMatch(/config\.json\.backup-\d{8}-\d{6}$/);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('backup is byte-identical to original', () => {
    const filePath = join(TEST_DIR, 'config.json');
    const content = '{"key": "value", "nested": {"a": 1}}';
    writeFileSync(filePath, content);

    const backupPath = createBackup(filePath);
    expect(readFileSync(backupPath, 'utf-8')).toBe(content);
  });
});

describe('detectIndent', () => {
  it('detects 2-space indentation', () => {
    const content = '{\n  "key": "value"\n}';
    expect(detectIndent(content)).toEqual({ type: 'space', amount: 2 });
  });

  it('detects 4-space indentation', () => {
    const content = '{\n    "key": "value"\n}';
    expect(detectIndent(content)).toEqual({ type: 'space', amount: 4 });
  });

  it('detects tab indentation', () => {
    const content = '{\n\t"key": "value"\n}';
    expect(detectIndent(content)).toEqual({ type: 'tab', amount: 1 });
  });

  it('defaults to 2 spaces for compact JSON', () => {
    const content = '{"key":"value"}';
    expect(detectIndent(content)).toEqual({ type: 'space', amount: 2 });
  });

  it('defaults to 2 spaces for empty string', () => {
    expect(detectIndent('')).toEqual({ type: 'space', amount: 2 });
  });
});

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const target = { a: 1, b: 2 };
    const source = { c: 3 };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('overwrites leaf conflicts with source value', () => {
    const target = { a: 1 };
    const source = { a: 2 };
    expect(deepMerge(target, source)).toEqual({ a: 2 });
  });

  it('preserves sibling keys in nested objects', () => {
    const target = {
      mcpServers: {
        existingTool: { command: 'existing' },
      },
    };
    const source = {
      mcpServers: {
        'ai-browser-copilot': { command: 'new-binary' },
      },
    };
    const result = deepMerge(target, source);
    expect(result).toEqual({
      mcpServers: {
        existingTool: { command: 'existing' },
        'ai-browser-copilot': { command: 'new-binary' },
      },
    });
  });

  it('preserves non-mcpServers keys', () => {
    const target = { theme: 'dark', mcpServers: { tool1: {} } };
    const source = { mcpServers: { tool2: {} } };
    const result = deepMerge(target, source);
    expect(result).toEqual({
      theme: 'dark',
      mcpServers: { tool1: {}, tool2: {} },
    });
  });

  it('handles deeply nested merge', () => {
    const target = { a: { b: { c: 1, d: 2 } } };
    const source = { a: { b: { e: 3 } } };
    expect(deepMerge(target, source)).toEqual({ a: { b: { c: 1, d: 2, e: 3 } } });
  });

  it('does not mutate target', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    deepMerge(target, source);
    expect(target).toEqual({ a: 1 });
  });

  it('handles arrays as leaf values (overwrites, not concatenates)', () => {
    const target = { args: ['old'] };
    const source = { args: ['new'] };
    expect(deepMerge(target, source)).toEqual({ args: ['new'] });
  });
});

describe('mergeConfig', () => {
  it('creates new file when config does not exist', () => {
    const filePath = join(TEST_DIR, 'new-config.json');
    const result = mergeConfig(filePath, { key: 'value' });

    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(existsSync(filePath)).toBe(true);

    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written).toEqual({ key: 'value' });
  });

  it('merges into existing config preserving all keys', () => {
    const filePath = join(TEST_DIR, 'existing.json');
    writeFileSync(filePath, JSON.stringify({ existing: true, mcpServers: { tool1: {} } }, null, 2) + '\n');

    const result = mergeConfig(filePath, { mcpServers: { 'ai-browser-copilot': { command: 'test' } } });

    expect(result.success).toBe(true);
    expect(result.action).toBe('merged');
    expect(result.backupPath).toBeDefined();

    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written.existing).toBe(true);
    expect(written.mcpServers.tool1).toEqual({});
    expect(written.mcpServers['ai-browser-copilot']).toEqual({ command: 'test' });
  });

  it('creates backup before merging', () => {
    const filePath = join(TEST_DIR, 'backup-test.json');
    writeFileSync(filePath, '{"original": true}');

    const result = mergeConfig(filePath, { added: true });
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(readFileSync(result.backupPath!, 'utf-8')).toBe('{"original": true}');
  });

  it('preserves 4-space indentation', () => {
    const filePath = join(TEST_DIR, 'four-space.json');
    writeFileSync(filePath, '{\n    "key": "value"\n}\n');

    mergeConfig(filePath, { added: true });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('    "key"');
    expect(content).toContain('    "added"');
  });

  it('preserves tab indentation', () => {
    const filePath = join(TEST_DIR, 'tab-indent.json');
    writeFileSync(filePath, '{\n\t"key": "value"\n}\n');

    mergeConfig(filePath, { added: true });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('\t"key"');
    expect(content).toContain('\t"added"');
  });

  it('preserves trailing newline', () => {
    const filePath = join(TEST_DIR, 'trailing.json');
    writeFileSync(filePath, '{"key": "value"}\n');

    mergeConfig(filePath, { added: true });
    expect(readFileSync(filePath, 'utf-8').endsWith('\n')).toBe(true);
  });

  it('does not add trailing newline when original lacks one', () => {
    const filePath = join(TEST_DIR, 'no-trailing.json');
    writeFileSync(filePath, '{\n  "key": "value"\n}');

    mergeConfig(filePath, { added: true });
    const content = readFileSync(filePath, 'utf-8');
    expect(content.endsWith('\n')).toBe(false);
  });

  it('returns error for malformed JSON without writing', () => {
    const filePath = join(TEST_DIR, 'malformed.json');
    writeFileSync(filePath, '{ broken json !!!');

    const result = mergeConfig(filePath, { key: 'value' });
    expect(result.success).toBe(false);
    expect(result.action).toBe('skipped');
    expect(result.error).toContain('malformed JSON');

    // Original file untouched
    expect(readFileSync(filePath, 'utf-8')).toBe('{ broken json !!!');
  });

  it('no backup created for malformed JSON', () => {
    const filePath = join(TEST_DIR, 'malformed2.json');
    writeFileSync(filePath, 'not json');

    mergeConfig(filePath, { key: 'value' });

    // No backup file should exist
    const files = require('node:fs').readdirSync(TEST_DIR) as string[];
    const backups = files.filter((f: string) => f.includes('.backup-'));
    expect(backups).toHaveLength(0);
  });

  it('new files use 2-space indent with trailing newline', () => {
    const filePath = join(TEST_DIR, 'brand-new.json');
    mergeConfig(filePath, { key: 'value' });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n  "key": "value"\n}\n');
  });
});

describe('verifyWrite', () => {
  it('succeeds for valid JSON file', () => {
    const filePath = join(TEST_DIR, 'valid.json');
    writeFileSync(filePath, '{"key": "value"}');
    expect(() => verifyWrite(filePath)).not.toThrow();
  });

  it('throws for invalid JSON file', () => {
    const filePath = join(TEST_DIR, 'invalid.json');
    writeFileSync(filePath, 'not json');
    expect(() => verifyWrite(filePath)).toThrow();
  });
});

describe('integration: full merge flow', () => {
  it('handles Claude Desktop config merge', () => {
    const filePath = join(TEST_DIR, 'claude_desktop_config.json');
    const existingConfig = {
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
      },
    };
    writeFileSync(filePath, JSON.stringify(existingConfig, null, 2) + '\n');

    const result = mergeConfig(filePath, {
      mcpServers: {
        'ai-browser-copilot': { command: 'C:\\path\\to\\binary.exe', args: [] },
      },
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe('merged');

    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(Object.keys(written.mcpServers)).toEqual(['filesystem', 'github', 'ai-browser-copilot']);
    expect(written.mcpServers.filesystem.command).toBe('npx');
    expect(written.mcpServers['ai-browser-copilot'].command).toBe('C:\\path\\to\\binary.exe');
  });

  it('handles VS Code settings.json merge with many existing settings', () => {
    const filePath = join(TEST_DIR, 'settings.json');
    const existingSettings: Record<string, unknown> = {
      'editor.fontSize': 14,
      'editor.tabSize': 2,
      'workbench.colorTheme': 'One Dark Pro',
      'terminal.integrated.shell.windows': 'C:\\Windows\\System32\\bash.exe',
      'files.autoSave': 'afterDelay',
    };
    // Add 50 more settings
    for (let i = 0; i < 50; i++) {
      existingSettings[`custom.setting.${i}`] = `value-${i}`;
    }
    writeFileSync(filePath, JSON.stringify(existingSettings, null, 4) + '\n');

    const result = mergeConfig(filePath, {
      mcp: {
        servers: {
          'ai-browser-copilot': { command: '/path/to/binary', args: [] },
        },
      },
    });

    expect(result.success).toBe(true);
    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written['editor.fontSize']).toBe(14);
    expect(written['workbench.colorTheme']).toBe('One Dark Pro');
    expect(Object.keys(written).length).toBe(Object.keys(existingSettings).length + 1); // +1 for mcp
    expect(written.mcp.servers['ai-browser-copilot'].command).toBe('/path/to/binary');

    // Verify 4-space indent preserved
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('    "editor.fontSize"');
  });
});
