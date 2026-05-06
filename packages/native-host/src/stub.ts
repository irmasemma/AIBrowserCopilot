import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import {
  readLockFile,
  checkExistingInstance,
  getDefaultIpcPath,
  getStartingLockPath,
  deleteLockFile,
} from './lock-file-manager.js';

const SPAWN_WAIT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const IPC_RETRY_DELAY_MS = 200;

if (process.argv.includes('--version')) {
  process.stdout.write('0.2.0\n');
  process.exit(0);
}

function detectStartedBy(): string {
  const flagArg = process.argv.find((a) => a.startsWith('--started-by='));
  if (flagArg) return flagArg.split('=')[1] ?? 'unknown';
  if (process.env['COPILOT_STARTED_BY']) return process.env['COPILOT_STARTED_BY'];
  if (process.env['CLAUDECODE'] || process.env['CLAUDE_CODE_ENTRYPOINT']) return 'Claude Code';
  if (process.env['CURSOR_TRACE_ID'] || process.env['CURSOR_CHANNEL']) return 'Cursor';
  if (process.env['VSCODE_PID'] || process.env['TERM_PROGRAM'] === 'vscode') return 'VS Code';
  if (process.env['WINDSURF_SESSION']) return 'Windsurf';
  return 'unknown';
}

function resolveServiceBinary(): string {
  if (process.env['COPILOT_SERVICE_BIN']) return process.env['COPILOT_SERVICE_BIN'];
  // Same directory as the stub's own binary; sibling file named "service[.exe]".
  const dir = dirname(process.execPath);
  return join(dir, platform() === 'win32' ? 'ai-browser-copilot-service.exe' : 'ai-browser-copilot-service');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryAcquireStartingLock(): Promise<boolean> {
  const startingPath = getStartingLockPath();
  try {
    writeFileSync(startingPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseStartingLock(): void {
  try { unlinkSync(getStartingLockPath()); } catch { /* best effort */ }
}

async function waitForServiceAlive(deadlineMs: number): Promise<{ ipcPath: string } | null> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const status = await checkExistingInstance();
    if (status === 'alive') {
      const lock = readLockFile();
      if (lock?.ipcPath) return { ipcPath: lock.ipcPath };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function spawnDetachedService(startedBy: string): void {
  const bin = resolveServiceBinary();
  const child = spawn(bin, [`--started-by=${startedBy}`], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, COPILOT_STARTED_BY: startedBy },
  });
  child.unref();
}

function pipe(socket: net.Socket): void {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);

  const exit = (code: number) => {
    socket.end();
    process.exit(code);
  };

  socket.on('close', () => exit(0));
  socket.on('error', (err) => {
    process.stderr.write(`[stub] IPC error: ${err.message}\n`);
    exit(1);
  });
  process.stdin.on('end', () => exit(0));
  process.stdin.on('close', () => exit(0));
}

function connectIpc(ipcPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ipcPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (err) => reject(err));
  });
}

async function ensureService(startedBy: string): Promise<string> {
  // Fast path: service already alive
  let status = await checkExistingInstance();
  if (status === 'alive') {
    const lock = readLockFile();
    if (lock?.ipcPath) return lock.ipcPath;
  }
  if (status === 'orphaned') {
    deleteLockFile();
  }

  // Try to become the spawner; otherwise wait for whoever is.
  const acquired = await tryAcquireStartingLock();
  if (acquired) {
    try {
      spawnDetachedService(startedBy);
      const ready = await waitForServiceAlive(SPAWN_WAIT_MS);
      if (!ready) {
        throw new Error(`Service did not become ready within ${SPAWN_WAIT_MS}ms`);
      }
      return ready.ipcPath;
    } finally {
      releaseStartingLock();
    }
  }

  // Loser: poll until winner brings the service up
  const ready = await waitForServiceAlive(SPAWN_WAIT_MS);
  if (!ready) {
    throw new Error(`Service did not become ready within ${SPAWN_WAIT_MS}ms (lost spawn race)`);
  }
  return ready.ipcPath;
}

const main = async (): Promise<void> => {
  const startedBy = detectStartedBy();
  const ipcPath = process.env['COPILOT_IPC_PATH'] ?? await ensureService(startedBy);

  let socket: net.Socket;
  try {
    socket = await connectIpc(ipcPath);
  } catch {
    // Service may have crashed between lock-read and connect — retry once.
    await sleep(IPC_RETRY_DELAY_MS);
    try {
      socket = await connectIpc(ipcPath);
    } catch (err) {
      process.stderr.write(`[stub] failed to connect to service at ${ipcPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      // Treat as stale and bubble up to caller (MCP client) as a clean exit.
      // The next stub launch will respawn the service.
      const fallbackPath = getDefaultIpcPath();
      if (fallbackPath !== ipcPath) {
        process.stderr.write(`[stub] note: default IPC path is ${fallbackPath}\n`);
      }
      process.exit(1);
    }
  }

  pipe(socket);
};

main().catch((err: unknown) => {
  process.stderr.write(`[stub] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
