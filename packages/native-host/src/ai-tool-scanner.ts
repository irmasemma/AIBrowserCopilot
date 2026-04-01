import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface ToolScanResult {
  tool: string;
  slug: string;
  installed: boolean;
  configured: boolean;
  configPath: string;
}

interface ToolDetector {
  name: string;
  slug: string;
  getConfigPaths(): string[];
  getMcpKeyPath(): string[];
}

function appDataDir(): string {
  const plat = platform();
  if (plat === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  if (plat === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return join(homedir(), '.config');
}

function editorConfigPaths(appName: string): string[] {
  return [join(appDataDir(), appName, 'User', 'settings.json')];
}

function jetbrainsConfigPaths(): string[] {
  const base = appDataDir();
  const jbDir = join(base, 'JetBrains');
  if (!existsSync(jbDir)) return [join(jbDir, 'Unknown', 'mcp.json')];
  try {
    const entries = readdirSync(jbDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (dirs.length === 0) return [join(jbDir, 'Unknown', 'mcp.json')];
    return dirs.map(d => join(jbDir, d, 'mcp.json'));
  } catch {
    return [join(jbDir, 'Unknown', 'mcp.json')];
  }
}

const detectors: ToolDetector[] = [
  {
    name: 'Claude Desktop',
    slug: 'claude-desktop',
    getConfigPaths() {
      const plat = platform();
      if (plat === 'win32') return [join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')];
      if (plat === 'darwin') return [join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
      return [join(homedir(), '.config', 'Claude', 'claude_desktop_config.json')];
    },
    getMcpKeyPath() { return ['mcpServers']; },
  },
  {
    name: 'Claude Code',
    slug: 'claude-code',
    getConfigPaths() { return [join(homedir(), '.claude.json')]; },
    getMcpKeyPath() { return ['mcpServers']; },
  },
  {
    name: 'VS Code',
    slug: 'vscode',
    getConfigPaths() { return editorConfigPaths('Code'); },
    getMcpKeyPath() { return ['mcp', 'servers']; },
  },
  {
    name: 'Cursor',
    slug: 'cursor',
    getConfigPaths() { return editorConfigPaths('Cursor'); },
    getMcpKeyPath() { return ['mcp', 'servers']; },
  },
  {
    name: 'Windsurf',
    slug: 'windsurf',
    getConfigPaths() { return editorConfigPaths('Windsurf'); },
    getMcpKeyPath() { return ['mcpServers']; },
  },
  {
    name: 'JetBrains',
    slug: 'jetbrains',
    getConfigPaths() { return jetbrainsConfigPaths(); },
    getMcpKeyPath() { return ['mcpServers']; },
  },
  {
    name: 'Zed',
    slug: 'zed',
    getConfigPaths() {
      const plat = platform();
      if (plat === 'darwin') return [join(homedir(), '.zed', 'settings.json')];
      return [join(homedir(), '.config', 'zed', 'settings.json')];
    },
    getMcpKeyPath() { return ['language_models', 'mcp_servers']; },
  },
  {
    name: 'Continue.dev',
    slug: 'continue',
    getConfigPaths() {
      return [
        join(homedir(), '.continue', 'config.json'),
        join(homedir(), '.continue', 'config.yaml'),
      ];
    },
    getMcpKeyPath() { return ['mcpServers']; },
  },
];

function resolveKeyPath(obj: unknown, keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hasCopilotEntry(mcpValue: unknown): boolean {
  if (mcpValue === null || mcpValue === undefined) return false;
  if (Array.isArray(mcpValue)) {
    return mcpValue.some(
      (item) => typeof item === 'object' && item !== null && ('ai-browser-copilot' in item || (item as Record<string, unknown>).name === 'ai-browser-copilot'),
    );
  }
  if (typeof mcpValue === 'object') {
    return 'ai-browser-copilot' in (mcpValue as Record<string, unknown>);
  }
  return false;
}

function scanDetector(detector: ToolDetector): ToolScanResult {
  const paths = detector.getConfigPaths();

  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;

    // File exists — tool is installed
    try {
      const content = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      const mcpValue = resolveKeyPath(parsed, detector.getMcpKeyPath());
      const configured = hasCopilotEntry(mcpValue);
      return { tool: detector.name, slug: detector.slug, installed: true, configured, configPath };
    } catch {
      // Malformed JSON
      return { tool: detector.name, slug: detector.slug, installed: true, configured: false, configPath };
    }
  }

  // No config file found
  return { tool: detector.name, slug: detector.slug, installed: false, configured: false, configPath: paths[0] };
}

export function scanAITools(): ToolScanResult[] {
  return detectors.map(scanDetector);
}
