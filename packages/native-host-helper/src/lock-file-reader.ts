import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

export interface LockFileData {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  version: string;
  startedBy: string;
}

function getLockDir(): string {
  switch (platform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ai-browser-copilot');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'ai-browser-copilot');
    default:
      return join(homedir(), '.local', 'share', 'ai-browser-copilot');
  }
}

export function getLockFilePath(): string {
  return join(getLockDir(), 'server.lock');
}

export function readLockFile(lockPath?: string): { exists: true; data: LockFileData } | { exists: false } {
  const filePath = lockPath ?? getLockFilePath();
  if (!existsSync(filePath)) {
    return { exists: false };
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as LockFileData;
    return { exists: true, data };
  } catch {
    return { exists: false };
  }
}
