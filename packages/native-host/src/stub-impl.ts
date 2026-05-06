import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

export const STUB_VERSION = '0.2.0';

export function detectStartedBy(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flagArg = argv.find((a) => a.startsWith('--started-by='));
  if (flagArg) return flagArg.split('=')[1] ?? 'unknown';
  if (env['COPILOT_STARTED_BY']) return env['COPILOT_STARTED_BY'];
  if (env['CLAUDECODE'] || env['CLAUDE_CODE_ENTRYPOINT']) return 'Claude Code';
  if (env['CURSOR_TRACE_ID'] || env['CURSOR_CHANNEL']) return 'Cursor';
  if (env['VSCODE_PID'] || env['TERM_PROGRAM'] === 'vscode') return 'VS Code';
  if (env['WINDSURF_SESSION']) return 'Windsurf';
  return 'unknown';
}

// Mirrors the asset naming used by the installer
// (packages/installer/src/shared/constants.ts SERVICE_ASSET_MAP).
// Keep the two in sync when adding new platforms.
export function serviceBinaryAssetName(
  plat: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const archSuffix = arch === 'arm64' ? 'arm64' : 'x64';
  switch (plat) {
    case 'win32':
      return `ai-browser-copilot-service-win-${archSuffix}.exe`;
    case 'darwin':
      return `ai-browser-copilot-service-macos-${archSuffix}`;
    default:
      return `ai-browser-copilot-service-linux-${archSuffix}`;
  }
}

export function resolveServiceBinary(): string {
  if (process.env['COPILOT_SERVICE_BIN']) return process.env['COPILOT_SERVICE_BIN'];
  // Same directory as the stub's own binary; platform-suffixed sibling.
  const dir = dirname(process.execPath);
  return join(dir, serviceBinaryAssetName());
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

export function spawnDetachedService(startedBy: string): void {
  const bin = resolveServiceBinary();
  // Determine launcher: if the binary is a .cjs/.js (test/dev), launch via node;
  // if it's a native pkg-compiled binary, launch directly.
  const isJsBundle = bin.endsWith('.cjs') || bin.endsWith('.js');
  const cmd = isJsBundle ? process.execPath : bin;
  const args = isJsBundle ? [bin, `--started-by=${startedBy}`] : [`--started-by=${startedBy}`];
  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, COPILOT_STARTED_BY: startedBy },
  });
  child.unref();
}

export function pipeStdioToSocket(socket: net.Socket): void {
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

export function connectIpc(ipcPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ipcPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', (err) => reject(err));
  });
}

export async function ensureService(startedBy: string): Promise<string> {
  // Fast path: service already alive
  const status = await checkExistingInstance();
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

export async function runStub(): Promise<void> {
  const startedBy = detectStartedBy();
  // Always discover via lock file. (COPILOT_IPC_PATH is honored by the
  // service when it picks where to listen, and propagates to the stub
  // through the lock file the service writes — no direct env shortcut here,
  // otherwise the stub would skip spawning a service that isn't yet running.)
  const ipcPath = await ensureService(startedBy);

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
      const fallbackPath = getDefaultIpcPath();
      if (fallbackPath !== ipcPath) {
        process.stderr.write(`[stub] note: default IPC path is ${fallbackPath}\n`);
      }
      process.exit(1);
    }
  }

  pipeStdioToSocket(socket);
}
