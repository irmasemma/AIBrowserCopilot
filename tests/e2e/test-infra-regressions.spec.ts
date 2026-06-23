/**
 * Regression coverage for three test-infra bugs found while building the
 * multi-client + Threads-export e2e specs (see docs/e2e-tests.md):
 *
 *   1. Bridge readiness was detected by matching a "Server started on
 *      127.0.0.1:<port>" line on stderr — the bridge never prints that. The
 *      real signal is the server.lock file written from the 'listening'
 *      handler. This test proves the lock file is the readiness signal.
 *
 *   2. real-chrome.ts treated Chrome Dev/Beta/SxS as able to load unpacked
 *      extensions. Chrome Dev 151 ignores --load-extension too (verified). The
 *      capability helper must report EVERY Google Chrome channel as blocked.
 *
 *   3. CLAUDE.md documented stale env vars (COPILOT_TEST_*). The specs read
 *      AGENTHUB_TEST_*. This test guards against the doc drifting back.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { isLoadExtensionBlocked } from './helpers/real-chrome';

const REPO_ROOT = path.resolve(__dirname, '../..');
const serviceDist = path.resolve(REPO_ROOT, 'packages/native-host/dist/service.js');

// ── Issue 1 — readiness is the lock file, not a stderr line ────────────────
test.describe('regression: bridge readiness signal', () => {
  test('startServer announces readiness by writing server.lock with pid+port (no stderr line)', async () => {
    test.setTimeout(30_000);

    // Drive startServer() directly on an EPHEMERAL port (not the hardcoded
    // 7483) so this never fights the developer's live bridge — always runs,
    // never destructive. Spawned in a child so cleanup is a kill.
    const installParent = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-ready-'));
    const lockFile = path.join(installParent, 'agenthub', 'server.lock');
    fs.mkdirSync(path.join(installParent, 'agenthub'), { recursive: true });
    const ephemeralPort = 17483; // unlikely to collide; the test reads the real value back

    const launcher =
      `import('file:///${serviceDist.replace(/\\/g, '/')}')` +
      `.then(m => m.startServer(${ephemeralPort}))`;

    let bridge: ChildProcess | undefined;
    try {
      bridge = spawn(process.execPath, ['--input-type=module', '-e', launcher], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: '1', LOCALAPPDATA: installParent, AGENTHUB_INSTALL_DIR: path.join(installParent, 'agenthub') },
      });
      let stderr = '';
      bridge.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      let exited: number | null = null;
      bridge.on('exit', (c) => { exited = c ?? -1; });

      const lock = await new Promise<{ port: number; pid: number }>((resolve, reject) => {
        const deadline = Date.now() + 15_000;
        const poll = () => {
          if (exited !== null) return reject(new Error(`bridge exited: ${exited}\n${stderr.slice(0, 400)}`));
          try {
            const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { port?: number; pid?: number };
            if (l.port && l.pid) return resolve(l as { port: number; pid: number });
          } catch { /* not yet */ }
          if (Date.now() > deadline) return reject(new Error('no server.lock within 15s'));
          setTimeout(poll, 200);
        };
        poll();
      });

      // The lock file IS the readiness signal: carries the bound port + pid.
      expect(lock.port).toBe(ephemeralPort);
      expect(lock.pid).toBe(bridge.pid);
      // The bug: a "Server started on 127.0.0.1:<port>" stderr line was the old
      // readiness signal — it is never emitted, so the regex could never match.
      expect(stderr).not.toMatch(/Server started on 127\.0\.0\.1:\d+/);
    } finally {
      if (bridge && !bridge.killed) { bridge.kill(); await new Promise((r) => setTimeout(r, 300)); }
    }
  });
});

// ── Issue 2 — every Google Chrome channel blocks --load-extension ──────────
test.describe('regression: real-chrome load-extension capability', () => {
  const chromeChannels = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
    'C:\\Users\\me\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe',
  ];

  for (const exe of chromeChannels) {
    test(`Chrome channel is blocked: ${exe.includes('Chrome Dev') ? 'Dev' : exe.includes('Beta') ? 'Beta' : exe.includes('SxS') ? 'Canary' : 'stable'}`, () => {
      expect(isLoadExtensionBlocked(exe)).toBe(true);
    });
  }

  test('Edge is NOT blocked (still honours --load-extension)', () => {
    expect(isLoadExtensionBlocked('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')).toBe(false);
  });
});

// ── Issue 3 — docs use AGENTHUB_TEST_*, never the stale COPILOT_TEST_* ──────
test.describe('regression: env-var documentation', () => {
  test('CLAUDE.md does not reference the stale COPILOT_TEST_ prefix', () => {
    const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    const hits = claudeMd.match(/COPILOT_TEST_[A-Z_]+/g) ?? [];
    expect(hits, `CLAUDE.md still references stale env vars: ${hits.join(', ')}`).toEqual([]);
  });

  test('real-chrome.ts reads the AGENTHUB_TEST_ prefix', () => {
    const helper = fs.readFileSync(path.join(__dirname, 'helpers/real-chrome.ts'), 'utf8');
    expect(helper).toMatch(/AGENTHUB_TEST_KILL_CHROME/);
    expect(helper).toMatch(/AGENTHUB_TEST_BROWSER/);
  });
});
