import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLockFile,
  writeLockFile,
  deleteLockFile,
  generateToken,
  checkExistingInstance,
  killProcess,
  waitForProcessExit,
  type LockFileData,
} from './lock-file-manager.js';

const TEST_DIR = join(tmpdir(), 'copilot-lock-test-' + process.pid);
const TEST_LOCK = join(TEST_DIR, 'server.lock');

function makeLockData(overrides?: Partial<LockFileData>): LockFileData {
  return {
    pid: process.pid,
    port: 7483,
    token: 'abc123',
    startedAt: new Date().toISOString(),
    version: '0.1.0',
    startedBy: 'test',
    ...overrides,
  };
}

describe('lock-file-manager', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('generateToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns unique tokens on each call', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
    });
  });

  describe('writeLockFile', () => {
    it('writes lock file with correct JSON content', () => {
      const data = makeLockData();
      writeLockFile(data, TEST_LOCK);
      const raw = readFileSync(TEST_LOCK, 'utf-8');
      expect(JSON.parse(raw)).toEqual(data);
    });

    it('creates parent directories if they do not exist', () => {
      const nested = join(TEST_DIR, 'deep', 'nested', 'server.lock');
      writeLockFile(makeLockData(), nested);
      expect(existsSync(nested)).toBe(true);
    });

    it('overwrites existing lock file', () => {
      writeLockFile(makeLockData({ port: 1111 }), TEST_LOCK);
      writeLockFile(makeLockData({ port: 2222 }), TEST_LOCK);
      const data = readLockFile(TEST_LOCK);
      expect(data?.port).toBe(2222);
    });
  });

  describe('readLockFile', () => {
    it('returns null if file does not exist', () => {
      expect(readLockFile(TEST_LOCK)).toBeNull();
    });

    it('returns parsed LockFileData when file exists', () => {
      const original = makeLockData();
      writeLockFile(original, TEST_LOCK);
      expect(readLockFile(TEST_LOCK)).toEqual(original);
    });

    it('returns null for malformed JSON', () => {
      const { writeFileSync } = require('node:fs');
      writeFileSync(TEST_LOCK, 'not json', 'utf-8');
      expect(readLockFile(TEST_LOCK)).toBeNull();
    });
  });

  describe('deleteLockFile', () => {
    it('removes the lock file', () => {
      writeLockFile(makeLockData(), TEST_LOCK);
      deleteLockFile(TEST_LOCK);
      expect(existsSync(TEST_LOCK)).toBe(false);
    });

    it('does not throw if file does not exist', () => {
      expect(() => deleteLockFile(TEST_LOCK)).not.toThrow();
    });
  });

  describe('checkExistingInstance', () => {
    it('returns "none" when no lock file exists', async () => {
      expect(await checkExistingInstance(TEST_LOCK)).toBe('none');
    });

    it('returns "orphaned" when PID is dead', async () => {
      // Use a PID that definitely doesn't exist
      writeLockFile(makeLockData({ pid: 999999 }), TEST_LOCK);
      expect(await checkExistingInstance(TEST_LOCK)).toBe('orphaned');
    });

    it('returns "orphaned" when PID is alive but WebSocket probe fails', async () => {
      // Our own PID is alive, but nothing listens on port 19999
      writeLockFile(makeLockData({ pid: process.pid, port: 19999 }), TEST_LOCK);
      const result = await checkExistingInstance(TEST_LOCK);
      expect(result).toBe('orphaned');
    });

    it('returns "orphaned" when port responds but PID does not match server_info', async () => {
      const { WebSocketServer } = await import('ws');
      const port = 18777;
      // Fake server that sends server_info with a different PID
      const wss = new WebSocketServer({ host: '127.0.0.1', port });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'server_info', pid: 999888 }));
      });

      try {
        writeLockFile(makeLockData({ pid: process.pid, port }), TEST_LOCK);
        const result = await checkExistingInstance(TEST_LOCK);
        // PID in lock file (process.pid) does not match server_info PID (999888)
        expect(result).toBe('orphaned');
      } finally {
        wss.close();
      }
    });

    it('returns "alive" when port responds with matching PID in server_info', async () => {
      const { WebSocketServer } = await import('ws');
      const port = 18778;
      const wss = new WebSocketServer({ host: '127.0.0.1', port });
      wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'server_info', pid: process.pid }));
      });

      try {
        writeLockFile(makeLockData({ pid: process.pid, port }), TEST_LOCK);
        const result = await checkExistingInstance(TEST_LOCK);
        expect(result).toBe('alive');
      } finally {
        wss.close();
      }
    });
  });

  describe('killProcess', () => {
    it('returns false for a non-existent PID', () => {
      expect(killProcess(999999)).toBe(false);
    });
  });

  describe('waitForProcessExit', () => {
    it('returns true immediately for a dead PID', async () => {
      const result = await waitForProcessExit(999999, 1000);
      expect(result).toBe(true);
    });
  });
});
