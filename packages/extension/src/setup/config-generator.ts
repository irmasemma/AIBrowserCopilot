import { NATIVE_HOST_NAME } from '../shared/constants.js';

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
  }>;
}

export const generateClaudeConfig = (nativeHostPath: string): McpConfig => ({
  mcpServers: {
    'ai-browser-copilot': {
      command: 'node',
      args: [nativeHostPath],
    },
  },
});

export const getClaudeConfigPath = (): string => {
  const platform = navigator.userAgent.includes('Windows') ? 'windows'
    : navigator.userAgent.includes('Mac') ? 'macos' : 'linux';

  switch (platform) {
    case 'windows':
      return '%APPDATA%\\Claude\\claude_desktop_config.json';
    case 'macos':
      return '~/Library/Application Support/Claude/claude_desktop_config.json';
    default:
      return '~/.config/Claude/claude_desktop_config.json';
  }
};

export const getNativeHostInstallDir = (): string => {
  const platform = navigator.userAgent.includes('Windows') ? 'windows'
    : navigator.userAgent.includes('Mac') ? 'macos' : 'linux';

  switch (platform) {
    case 'windows':
      return '%LOCALAPPDATA%\\ai-browser-copilot';
    case 'macos':
      return '~/Library/Application Support/ai-browser-copilot';
    default:
      return '~/.local/share/ai-browser-copilot';
  }
};

export const getNativeMessagingManifest = (hostPath: string): object => ({
  name: NATIVE_HOST_NAME,
  description: 'AI Browser CoPilot Native Messaging Host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${chrome.runtime.id}/`],
});
