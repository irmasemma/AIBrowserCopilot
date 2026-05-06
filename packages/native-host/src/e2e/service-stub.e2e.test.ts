/**
 * Real-process end-to-end tests for the service + stub split.
 *
 * Builds bundles via esbuild on first run, then spawns *actual* child
 * processes for service and stub — no mocks, no in-process shortcuts.
 * Each test gets its own temp lock dir + IPC path via env-var overrides
 * so it never touches the user's real installation.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, platform as osPlatform } from 'node:os';

const PKG_ROOT = resolve(__dirname, '..', '..');
const SERVICE_BUNDLE = join(PKG_ROOT, 'bin', 'service.cjs');
const STUB_BUNDLE = join(PKG_ROOT, 'bin', 'stub.cjs');

function uniqueLockDir(label: string): string {
  return join(tmpdir(), `copilot-e2e-${label}-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
}

function uniqueIpcPath(label: string, lockDir: string): string {
  if (osPlatform() === 'win32') {
    return `\\\\.\\pipe\\copilot-e2e-${label}-${process.pid}-${Date.now()}`;
  }
  return join(lockDir, 'service.sock');
}

function readPidFromLock(lockPath: string): number | null {
  if (!existsSync(lockPath)) return null;
  try {
    const data = JSON.parse(readFileSync(lockPath, 'utf-8'));
    return typeof data.pid === 'number' ? data.pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killPidIfAlive(pid: number | null): void {
  if (pid && isProcessAlive(pid)) {
    try { process.kill(pid); } catch { /* best effort */ }
  }
}

async function waitFor<T>(
  pred: () => T | Promise<T>,
  ms = 5000,
  intervalMs = 50,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < ms) {
    last = await pred();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${ms}ms; last value=${JSON.stringify(last)}`);
}

beforeAll(() => {
  // Build the bundles once for the whole suite. Real artifacts, no mocks.
  if (!existsSync(SERVICE_BUNDLE) || !existsSync(STUB_BUNDLE)) {
    const result = spawnSync('npm', ['run', 'bundle'], {
      cwd: PKG_ROOT,
      stdio: 'pipe',
      shell: osPlatform() === 'win32',
    });
    if (result.status !== 0) {
      throw new Error(
        `bundle failed (exit ${result.status}):\n${result.stdout?.toString()}\n${result.stderr?.toString()}`,
      );
    }
  }
  expect(existsSync(SERVICE_BUNDLE)).toBe(true);
  expect(existsSync(STUB_BUNDLE)).toBe(true);
}, 60_000);

interface StubHandle {
  child: ChildProcess;
  stdoutBuffer: string;
  lines: string[];
  awaitLine(predicate: (line: any) => boolean, timeoutMs?: number): Promise<any>;
  send(json: object): void;
  kill(): void;
}

function spawnStub(env: Record<string, string>): StubHandle {
  const child = spawn(process.execPath, [STUB_BUNDLE], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const handle: StubHandle = {
    child,
    stdoutBuffer: '',
    lines: [],
    awaitLine(predicate, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const tryResolve = () => {
          for (const line of handle.lines) {
            try {
              const msg = JSON.parse(line);
              if (predicate(msg)) {
                handle.lines.length = 0;
                clearTimeout(timer);
                resolve(msg);
                return;
              }
            } catch { /* skip non-JSON lines */ }
          }
        };
        const onData = () => tryResolve();
        const timer = setTimeout(() => {
          child.stdout?.removeListener('data', onData);
          reject(new Error(`stub stdout did not yield expected line within ${timeoutMs}ms (got ${handle.lines.length} lines)`));
        }, timeoutMs);
        child.stdout?.on('data', onData);
        tryResolve();
      });
    },
    send(json) {
      child.stdin?.write(JSON.stringify(json) + '\n');
    },
    kill() {
      try { child.kill(); } catch { /* best effort */ }
    },
  };
  child.stdout?.on('data', (chunk: Buffer) => {
    handle.stdoutBuffer += chunk.toString('utf-8');
    let nl = handle.stdoutBuffer.indexOf('\n');
    while (nl >= 0) {
      handle.lines.push(handle.stdoutBuffer.slice(0, nl).trim());
      handle.stdoutBuffer = handle.stdoutBuffer.slice(nl + 1);
      nl = handle.stdoutBuffer.indexOf('\n');
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (process.env['E2E_VERBOSE']) {
      process.stderr.write(`[stub:${child.pid}] ${chunk.toString('utf-8')}`);
    }
  });
  return handle;
}

const initializeMessage = (id: number, name: string) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name, version: '1.0.0' },
  },
});

describe('e2e: service + stub real process spawn', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn?.(); } catch { /* best effort */ }
    }
  });

  function setupTempPaths(label: string): { lockDir: string; ipcPath: string; lockFile: string; baseEnv: Record<string, string> } {
    const lockDir = uniqueLockDir(label);
    mkdirSync(lockDir, { recursive: true });
    const ipcPath = uniqueIpcPath(label, lockDir);
    const lockFile = join(lockDir, 'server.lock');
    cleanups.push(() => {
      // Best-effort kill of any service the test spawned
      const pid = readPidFromLock(lockFile);
      killPidIfAlive(pid);
      try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best effort */ }
      // Clean up Unix socket if it leaked outside lockDir
      if (osPlatform() !== 'win32' && existsSync(ipcPath)) {
        try { unlinkSync(ipcPath); } catch { /* best effort */ }
      }
    });
    return {
      lockDir,
      ipcPath,
      lockFile,
      baseEnv: {
        COPILOT_LOCK_DIR: lockDir,
        COPILOT_IPC_PATH: ipcPath,
        COPILOT_SERVICE_BIN: SERVICE_BUNDLE,
      },
    };
  }

  it('stub spawns the service detached on first launch and connects', async () => {
    const { lockFile, baseEnv } = setupTempPaths('spawn-and-connect');

    expect(existsSync(lockFile)).toBe(false);

    const stub = spawnStub(baseEnv);
    cleanups.push(() => stub.kill());

    // Stub auto-spawns a service. Lock file should appear with a live PID.
    const lock = await waitFor(() => {
      if (!existsSync(lockFile)) return null;
      try { return JSON.parse(readFileSync(lockFile, 'utf-8')); } catch { return null; }
    }, 10_000, 100);
    expect(lock.pid).toBeGreaterThan(0);
    expect(lock.ipcPath).toBe(baseEnv.COPILOT_IPC_PATH);
    expect(isProcessAlive(lock.pid)).toBe(true);

    // Drive an MCP initialize through the stub's stdin.
    stub.send(initializeMessage(1, 'e2e-client'));
    const reply = await stub.awaitLine((m) => m.id === 1, 10_000);
    expect(reply.result?.serverInfo?.name).toBe('ai-browser-copilot');
  }, 30_000);

  it('two real stubs share one service and get independent responses', async () => {
    const { lockFile, baseEnv } = setupTempPaths('two-stubs');

    const stubA = spawnStub(baseEnv);
    cleanups.push(() => stubA.kill());

    // Wait for first stub to bring the service up
    await waitFor(() => existsSync(lockFile), 10_000, 100);
    const firstPid = readPidFromLock(lockFile);
    expect(firstPid).toBeGreaterThan(0);

    // Second stub launches *after* the service is up — should attach.
    const stubB = spawnStub(baseEnv);
    cleanups.push(() => stubB.kill());

    // Both initialize concurrently with distinct IDs.
    stubA.send(initializeMessage(11, 'stub-A'));
    stubB.send(initializeMessage(22, 'stub-B'));

    const [respA, respB] = await Promise.all([
      stubA.awaitLine((m) => m.id === 11, 10_000),
      stubB.awaitLine((m) => m.id === 22, 10_000),
    ]);
    expect(respA.id).toBe(11);
    expect(respB.id).toBe(22);

    // Service PID unchanged — no respawn, no kill.
    const finalPid = readPidFromLock(lockFile);
    expect(finalPid).toBe(firstPid);
    expect(isProcessAlive(finalPid!)).toBe(true);

    // Killing one stub does not take the other down.
    stubA.kill();
    await new Promise((r) => setTimeout(r, 300));
    expect(isProcessAlive(finalPid!)).toBe(true);
    stubB.send({ jsonrpc: '2.0', id: 33, method: 'tools/list' });
    const listReply = await stubB.awaitLine((m) => m.id === 33, 10_000);
    expect(listReply.result?.tools).toBeInstanceOf(Array);
  }, 45_000);

  it('service stays alive after all stubs disconnect (no idle shutdown)', async () => {
    const { lockFile, baseEnv } = setupTempPaths('no-idle');

    const stub = spawnStub(baseEnv);
    cleanups.push(() => stub.kill());

    await waitFor(() => existsSync(lockFile), 10_000, 100);
    const pid = readPidFromLock(lockFile);
    expect(pid).toBeGreaterThan(0);

    stub.send(initializeMessage(1, 'first'));
    await stub.awaitLine((m) => m.id === 1, 10_000);

    // Disconnect the only stub. Service should remain.
    stub.kill();
    await new Promise((r) => setTimeout(r, 1500));
    expect(isProcessAlive(pid!)).toBe(true);
    expect(readPidFromLock(lockFile)).toBe(pid);

    // A fresh stub attaches to the same service.
    const stub2 = spawnStub(baseEnv);
    cleanups.push(() => stub2.kill());
    stub2.send(initializeMessage(2, 'second'));
    await stub2.awaitLine((m) => m.id === 2, 10_000);
    expect(readPidFromLock(lockFile)).toBe(pid);
  }, 30_000);

  it('second stub does NOT kill the first (regression for hostile-takeover bug)', async () => {
    const { lockFile, baseEnv } = setupTempPaths('no-takeover');

    const stubA = spawnStub(baseEnv);
    cleanups.push(() => stubA.kill());

    await waitFor(() => existsSync(lockFile), 10_000, 100);
    const servicePid = readPidFromLock(lockFile);

    // Initialize stub A — confirm the call path is alive.
    stubA.send(initializeMessage(101, 'A'));
    await stubA.awaitLine((m) => m.id === 101, 10_000);

    // Now spawn B. Pre-Phase-1 this would have killed the first service.
    const stubB = spawnStub(baseEnv);
    cleanups.push(() => stubB.kill());
    stubB.send(initializeMessage(202, 'B'));
    await stubB.awaitLine((m) => m.id === 202, 10_000);

    // Service unchanged, A still works.
    expect(readPidFromLock(lockFile)).toBe(servicePid);
    expect(isProcessAlive(servicePid!)).toBe(true);
    stubA.send({ jsonrpc: '2.0', id: 102, method: 'tools/list' });
    const listA = await stubA.awaitLine((m) => m.id === 102, 10_000);
    expect(listA.result?.tools).toBeInstanceOf(Array);
  }, 45_000);

  it('orphaned lock from a dead PID is replaced cleanly', async () => {
    const { lockFile, baseEnv } = setupTempPaths('orphan');

    // Plant a stale lock file referencing a definitely-dead PID.
    writeFileSync(
      lockFile,
      JSON.stringify({
        pid: 999_999,
        port: 7484,
        token: '',
        startedAt: new Date().toISOString(),
        version: '0.2.0',
        startedBy: 'orphan-test',
        ipcPath: baseEnv.COPILOT_IPC_PATH,
      }),
      'utf-8',
    );

    const stub = spawnStub(baseEnv);
    cleanups.push(() => stub.kill());

    // Stub should detect 'orphaned', delete the stale lock, spawn a fresh service.
    const fresh = await waitFor(() => {
      const data = readPidFromLock(lockFile);
      return data && data !== 999_999 ? data : null;
    }, 10_000, 100);
    expect(fresh).toBeGreaterThan(0);
    expect(fresh).not.toBe(999_999);

    stub.send(initializeMessage(1, 'orphan-recovery'));
    const reply = await stub.awaitLine((m) => m.id === 1, 10_000);
    expect(reply.result?.serverInfo?.name).toBe('ai-browser-copilot');
  }, 30_000);
});
