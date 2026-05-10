import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import {
  findPidByPort,
  findPidsByImageName,
  isPortFree,
  waitForPortFree,
  killRunningNativeHost,
} from './process-killer.js';
import { detectPlatform } from '../shared/platform.js';

const platform = detectPlatform();

describe('isPortFree', () => {
  it('returns true when nothing is listening', async () => {
    expect(await isPortFree(38123)).toBe(true);
  });

  it('returns false when something is listening', async () => {
    const port = 38124;
    const srv = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => srv.once('listening', () => r(undefined)));
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      srv.close();
    }
  });
});

describe('findPidByPort', () => {
  it('returns the PID of the listening process', async () => {
    const port = 38201;
    const srv = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => srv.once('listening', () => r(undefined)));
    try {
      const pid = findPidByPort(port, platform);
      expect(pid).toBe(process.pid);
    } finally {
      srv.close();
    }
  });

  it('returns null when no one is listening', () => {
    expect(findPidByPort(38202, platform)).toBeNull();
  });

  it('handles a WebSocket server too', async () => {
    const port = 38203;
    const wss = new WebSocketServer({ host: '127.0.0.1', port });
    await new Promise((r) => wss.once('listening', () => r(undefined)));
    try {
      expect(findPidByPort(port, platform)).toBe(process.pid);
    } finally {
      wss.close();
    }
  });
});

describe('waitForPortFree', () => {
  it('resolves true immediately when port is already free', async () => {
    const t0 = Date.now();
    const result = await waitForPortFree(38301, 1000);
    expect(result).toBe(true);
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('resolves true after the listener closes', async () => {
    const port = 38302;
    const srv = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => srv.once('listening', () => r(undefined)));
    setTimeout(() => srv.close(), 200);
    expect(await waitForPortFree(port, 2000)).toBe(true);
  });

  it('resolves false if the port stays in use for the whole timeout', async () => {
    const port = 38303;
    const srv = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => srv.once('listening', () => r(undefined)));
    try {
      expect(await waitForPortFree(port, 300)).toBe(false);
    } finally {
      srv.close();
    }
  });
});

describe('findPidsByImageName', () => {
  let child: ChildProcess | null = null;

  afterEach(() => {
    if (child && child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort
      }
    }
    child = null;
  });

  it('returns [] when no process with that image name is running', () => {
    const pids = findPidsByImageName('definitely-not-a-real-binary-xyz123', platform);
    expect(pids).toEqual([]);
  });

  it('finds a spawned child process by its image name', async () => {
    // Spawn a long-running child using the current node binary. The image
    // name reported by tasklist/pgrep is the basename of process.execPath
    // (e.g. node.exe on Windows, node on POSIX).
    const script = `setInterval(() => {}, 1000); process.stderr.write('ready\\n');`;
    child = spawn(process.execPath, ['-e', script], { stdio: 'pipe' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child did not start')), 5000);
      child!.stderr!.on('data', (d) => {
        if (d.toString().includes('ready')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const imageName = basename(process.execPath);
    const pids = findPidsByImageName(imageName, platform);
    expect(pids).toContain(child.pid);
    // Test runner is itself a node process, so we expect at least 2 matches.
    expect(pids.length).toBeGreaterThanOrEqual(2);
  }, 10000);
});

describe('killRunningNativeHost', () => {
  it('returns {killed:false, portFree:true} when nothing is listening on the port', async () => {
    const result = await killRunningNativeHost(platform, 38401);
    expect(result.killed).toBe(false);
    expect(result.portFree).toBe(true);
  });

  it('terminates a child Node process bound to the target port', async () => {
    // Start a child Node process listening on a specific port. We then ask
    // killRunningNativeHost to terminate it and verify the port is freed.
    const port = 38402;
    const script = `
      const net = require('node:net');
      const srv = net.createServer();
      srv.listen(${port}, '127.0.0.1', () => process.stderr.write('listening\\n'));
      // Stay alive forever
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: 'pipe' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child did not start')), 5000);
      child.stderr!.on('data', (d) => {
        if (d.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const result = await killRunningNativeHost(platform, port);
    expect(result.killed).toBe(true);
    expect(result.pid).toBe(child.pid);
    expect(result.portFree).toBe(true);

    // Sanity: child should have exited
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
    });
  }, 15000);

  it('returns empty pids array when nothing matches', async () => {
    const result = await killRunningNativeHost(platform, 38404, [
      'definitely-not-a-real-binary-xyz123',
    ]);
    expect(result.killed).toBe(false);
    expect(result.pids).toEqual([]);
  });
});
