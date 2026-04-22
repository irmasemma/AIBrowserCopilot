import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import net from 'node:net';

export interface LockFileData {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  version: string;
  startedBy: string;
}

export interface LockFileResult {
  exists: boolean;
  data?: LockFileData;
  stale?: boolean;
  stalePid?: number;
  hasWake?: boolean;
  wakeTimestamp?: number;
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

export function getWakeFilePath(): string {
  return join(getLockDir(), 'server.wake');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isPortListening(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

function readWakeFile(): { hasWake: boolean; wakeTimestamp?: number } {
  const wakePath = getWakeFilePath();
  if (!existsSync(wakePath)) return { hasWake: false };
  try {
    const content = readFileSync(wakePath, 'utf-8');
    const data = JSON.parse(content);
    // Only consider wake files less than 60s old
    if (typeof data.timestamp === 'number' && Date.now() - data.timestamp < 60_000) {
      return { hasWake: true, wakeTimestamp: data.timestamp };
    }
    // Stale wake file — clean it up
    try { unlinkSync(wakePath); } catch { /* ignore */ }
    return { hasWake: false };
  } catch {
    return { hasWake: false };
  }
}

export async function readLockFile(lockPath?: string): Promise<LockFileResult> {
  const filePath = lockPath ?? getLockFilePath();
  if (!existsSync(filePath)) {
    return { exists: false };
  }

  let data: LockFileData;
  try {
    const content = readFileSync(filePath, 'utf-8');
    data = JSON.parse(content) as LockFileData;
  } catch {
    return { exists: false };
  }

  // AD-15: Validate PID is alive
  if (!isPidAlive(data.pid)) {
    deleteLockFile(filePath);
    return { exists: false, stale: true, stalePid: data.pid };
  }

  // AD-15: Validate port is actually listening (guards against PID reuse)
  const portOpen = await isPortListening(data.port);
  if (!portOpen) {
    deleteLockFile(filePath);
    return { exists: false, stale: true, stalePid: data.pid };
  }

  // AD-18: Check for wake file
  const wake = readWakeFile();

  return { exists: true, data, ...wake };
}

export function deleteLockFile(lockPath?: string): boolean {
  const filePath = lockPath ?? getLockFilePath();
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
