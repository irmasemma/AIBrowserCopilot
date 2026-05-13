import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';

export interface LockFileData {
  pid: number;
  port: number;
  token: string;
  ipcPath: string;
  startedAt: string;
  version: string;
  startedBy: string;
}

export type InstanceCheck = 'none' | 'alive' | 'orphaned';

function getLockDir(): string {
  switch (platform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub');
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'agenthub');
    default:
      return join(homedir(), '.local', 'share', 'agenthub');
  }
}

export function getLockFilePath(): string {
  return join(getLockDir(), 'server.lock');
}

export function getIpcPath(): string {
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\agenthub-${process.pid}`;
  }
  return join(getLockDir(), `service-${process.pid}.sock`);
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function readLockFile(lockPath?: string): LockFileData | null {
  const filePath = lockPath ?? getLockFilePath();
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as LockFileData;
  } catch {
    return null;
  }
}

export function writeLockFile(data: LockFileData, lockPath?: string): void {
  const filePath = lockPath ?? getLockFilePath();
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function deleteLockFile(lockPath?: string): void {
  const filePath = lockPath ?? getLockFilePath();
  try {
    unlinkSync(filePath);
  } catch {
    // Lock file already gone — that's fine
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeWebSocket(port: number, expectedPid: number, timeoutMs: number = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, timeoutMs);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => {
      // Don't resolve yet — wait for server_info to verify identity
    };
    ws.onmessage = (event) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(event.data));
        // Verify it's actually our server by checking type and PID
        ws.close();
        resolve(data.type === 'server_info' && data.pid === expectedPid);
      } catch {
        ws.close();
        resolve(false);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
}

export async function checkExistingInstance(lockPath?: string): Promise<InstanceCheck> {
  const lock = readLockFile(lockPath);
  if (!lock) return 'none';

  if (!isProcessAlive(lock.pid)) {
    return 'orphaned';
  }

  // PID is alive — probe WebSocket to confirm it's our server (not a random service on the same port)
  const isOurs = await probeWebSocket(lock.port, lock.pid);
  return isOurs ? 'alive' : 'orphaned';
}

export function registerCleanupHandlers(lockPath?: string): void {
  const cleanup = () => deleteLockFile(lockPath);
  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('uncaughtException', (err) => {
    cleanup();
    throw err;
  });
  process.on('unhandledRejection', (reason) => {
    cleanup();
    throw reason;
  });
}
