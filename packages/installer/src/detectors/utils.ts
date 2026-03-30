import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { PlatformInfo } from '../shared/platform.js';

/**
 * Check if a command is available in PATH.
 */
export const isCommandAvailable = (command: string, platform: PlatformInfo): boolean => {
  try {
    const cmd = platform.os === 'windows' ? `where ${command}` : `which ${command}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a JSON config file has an existing `ai-browser-copilot` MCP entry.
 * Supports both `mcpServers` (Claude) and `mcp.servers` (VS Code/Cursor) formats.
 */
export const hasExistingMcpEntry = (configPath: string): boolean => {
  if (!existsSync(configPath)) return false;

  try {
    const content = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Check Claude format: mcpServers
    if (content.mcpServers?.['ai-browser-copilot']) return true;

    // Check VS Code/Cursor format: mcp.servers
    if (content.mcp?.servers?.['ai-browser-copilot']) return true;

    return false;
  } catch {
    return false;
  }
};
