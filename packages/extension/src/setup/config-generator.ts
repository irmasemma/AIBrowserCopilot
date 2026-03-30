import { NATIVE_HOST_NAME } from '../shared/constants.js';

const BINARY_PREFIX = 'ai-browser-copilot';

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
  }>;
}

const detectPlatform = (): 'windows' | 'macos' | 'linux' => {
  if (navigator.userAgent.includes('Windows')) return 'windows';
  if (navigator.userAgent.includes('Mac')) return 'macos';
  return 'linux';
};

const getBinaryName = (): string => {
  const platform = detectPlatform();
  switch (platform) {
    case 'windows': return `${BINARY_PREFIX}-win-x64.exe`;
    case 'macos': return `${BINARY_PREFIX}-macos-arm64`;
    default: return `${BINARY_PREFIX}-linux-x64`;
  }
};

export const getNativeHostInstallDir = (): string => {
  const platform = detectPlatform();
  switch (platform) {
    case 'windows':
      return '%LOCALAPPDATA%\\ai-browser-copilot';
    case 'macos':
      return '~/Library/Application Support/ai-browser-copilot';
    default:
      return '~/.local/share/ai-browser-copilot';
  }
};

const getBinaryPath = (): string => {
  const platform = detectPlatform();
  const binaryName = getBinaryName();
  switch (platform) {
    case 'windows':
      return `%LOCALAPPDATA%\\\\ai-browser-copilot\\\\${binaryName}`;
    case 'macos':
      return `~/Library/Application Support/ai-browser-copilot/${binaryName}`;
    default:
      return `~/.local/share/ai-browser-copilot/${binaryName}`;
  }
};

export const generateMcpConfig = (): McpConfig => ({
  mcpServers: {
    'ai-browser-copilot': {
      command: getBinaryPath(),
      args: [],
    },
  },
});

export const getConfigInstructions = (): Array<{ app: string; path: string; instructions: string }> => [
  {
    app: 'VS Code',
    path: '.vscode/mcp.json (in your project)',
    instructions: 'Create a .vscode/mcp.json file in your project root with the config below.',
  },
  {
    app: 'Cursor',
    path: 'Settings → MCP Servers',
    instructions: 'Open Cursor Settings, go to MCP Servers, and add a new server with the config below.',
  },
  {
    app: 'Claude Desktop',
    path: getClaudeConfigPath(),
    instructions: 'Open the Claude Desktop config file and add the config below. Restart Claude Desktop after saving.',
  },
];

const getClaudeConfigPath = (): string => {
  const platform = detectPlatform();
  switch (platform) {
    case 'windows':
      return '%APPDATA%\\Claude\\claude_desktop_config.json';
    case 'macos':
      return '~/Library/Application Support/Claude/claude_desktop_config.json';
    default:
      return '~/.config/Claude/claude_desktop_config.json';
  }
};

export const getNativeMessagingManifest = (hostPath: string): object => ({
  name: NATIVE_HOST_NAME,
  description: 'AI Browser CoPilot Native Messaging Host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${chrome.runtime.id}/`],
});
