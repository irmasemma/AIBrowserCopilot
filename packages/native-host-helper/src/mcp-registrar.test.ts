import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkClaudeCodeRegistration, repairClaudeCodeRegistration } from './mcp-registrar.js';

const fakeHome = join(tmpdir(), `mcp-registrar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const fakeInstallDir = join(fakeHome, 'AppData', 'Local', 'agenthub');
const fakeBinaryName = process.platform === 'win32'
  ? `agenthub-win-${process.arch === 'arm64' ? 'arm64' : 'x64'}.exe`
  : process.platform === 'darwin'
    ? `agenthub-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
    : `agenthub-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const fakeBinaryPath = join(fakeInstallDir, fakeBinaryName);
const configPath = join(fakeHome, '.claude.json');

describe('mcp-registrar', () => {
  let prevHome: string | undefined;
  let prevUserprofile: string | undefined;
  let prevLocalAppData: string | undefined;

  beforeEach(() => {
    prevHome = process.env.HOME;
    prevUserprofile = process.env.USERPROFILE;
    prevLocalAppData = process.env.LOCALAPPDATA;

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.LOCALAPPDATA = join(fakeHome, 'AppData', 'Local');

    mkdirSync(fakeInstallDir, { recursive: true });

    // Patch homedir() lookups by clearing module cache; os.homedir reads env on Windows.
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserprofile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserprofile;
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
    try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('reports unregistered when ~/.claude.json does not exist', async () => {
    const { checkClaudeCodeRegistration: check } = await import('./mcp-registrar.js?fresh1');
    const result = check();
    expect(result.configExists).toBe(false);
    expect(result.registered).toBe(false);
    expect(result.scope).toBeNull();
  });

  it('detects user-scope registration', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { 'agenthub': { command: '/path/to/exe', args: [] } } }),
    );
    const { checkClaudeCodeRegistration: check } = await import('./mcp-registrar.js?fresh2');
    const result = check();
    expect(result.registered).toBe(true);
    expect(result.scope).toBe('user');
  });

  it('detects project-scope registration as scope=project', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {},
        projects: {
          '/some/project': {
            mcpServers: { 'agenthub': { command: '/path/to/exe', args: [] } },
          },
        },
      }),
    );
    const { checkClaudeCodeRegistration: check } = await import('./mcp-registrar.js?fresh3');
    const result = check();
    expect(result.registered).toBe(true);
    expect(result.scope).toBe('project');
  });

  it('repair fails with helpful error when binary is missing', async () => {
    const { repairClaudeCodeRegistration: repair } = await import('./mcp-registrar.js?fresh4');
    const result = repair();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Native host binary not found/);
  });

  it('repair writes user-scope entry pointing at the .exe and creates a backup', async () => {
    writeFileSync(fakeBinaryPath, ''); // create the fake binary
    writeFileSync(configPath, JSON.stringify({ otherKey: 'preserved', mcpServers: { existing: { command: 'foo' } } }, null, 2) + '\n');

    const { repairClaudeCodeRegistration: repair } = await import('./mcp-registrar.js?fresh5');
    const result = repair();

    expect(result.success).toBe(true);
    expect(result.scope).toBe('user');
    expect(result.binaryPath).toBe(fakeBinaryPath);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);

    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.otherKey).toBe('preserved'); // sibling keys untouched
    expect(written.mcpServers.existing).toBeDefined(); // sibling mcp entries untouched
    expect(written.mcpServers['agenthub'].command).toBe(fakeBinaryPath);
    expect(written.mcpServers['agenthub'].args).toEqual([]);
  });

  it('repair refuses to overwrite malformed JSON', async () => {
    writeFileSync(fakeBinaryPath, '');
    writeFileSync(configPath, '{not valid json');
    const { repairClaudeCodeRegistration: repair } = await import('./mcp-registrar.js?fresh6');
    const result = repair();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not valid JSON/i);
  });

  it('repair creates the file when ~/.claude.json does not yet exist', async () => {
    writeFileSync(fakeBinaryPath, '');
    const { repairClaudeCodeRegistration: repair } = await import('./mcp-registrar.js?fresh7');
    const result = repair();
    expect(result.success).toBe(true);
    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(written.mcpServers['agenthub'].command).toBe(fakeBinaryPath);
  });
});
