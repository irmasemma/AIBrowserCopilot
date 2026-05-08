#!/usr/bin/env node
// Launches Microsoft Edge with the user's real profile + a remote-debugging
// port + the built extension, then writes tests/e2e/.edge-debug.json so the
// `real-edge-via-cdp-*` Playwright specs can attach over CDP.
//
// Usage:
//   npm run edge:debug            -- uses port 9229, profile Default
//   npm run edge:debug -- --port 9230 --profile "Profile 1"
//
// Prereqs:
//   * All Edge windows must be CLOSED. Edge enforces a single-instance lock
//     on the user-data-dir; we refuse to launch if any msedge.exe is running.
//   * "Developer mode" must be ON in edge://extensions for --load-extension to
//     stick. If it isn't, Edge will silently ignore the unpacked extension.
//
// The script stays attached and forwards Edge's stdout/stderr; press Ctrl+C
// (or close Edge normally) to shut down. The .edge-debug.json file is removed
// on exit.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
const STATE_FILE = path.resolve(REPO_ROOT, 'tests/e2e/.edge-debug.json');

const EDGE_EXE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { port: 9229, profile: 'Default', userDataDir: null, fresh: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--port') out.port = Number(args[++i]);
    else if (a === '--profile') out.profile = args[++i];
    else if (a === '--user-data-dir') out.userDataDir = args[++i];
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/launch-edge-debug.mjs [--port N] [--profile NAME] [--user-data-dir PATH] [--fresh]

  --port           remote debugging port (default: 9229)
  --profile        profile directory name (default: Default)
  --user-data-dir  override user-data-dir; default = real Edge profile root
  --fresh          use a throwaway temp profile instead of the real one`);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
};

const findEdge = () => {
  for (const p of EDGE_EXE_CANDIDATES) if (existsSync(p)) return p;
  return null;
};

const isPortFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });

const waitForDebugPort = async (port, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      // not ready
    }
    await wait(400);
  }
  throw new Error(`Edge did not open debugging port ${port} within ${timeoutMs}ms`);
};

const isEdgeRunning = () => {
  // tasklist exits 0 even when nothing matches, so we check stdout instead.
  const r = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq msedge.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return false;
  return /msedge\.exe/i.test(r.stdout);
};

const main = async () => {
  const opts = parseArgs();

  if (!existsSync(EXTENSION_PATH)) {
    console.error(`✗ Built extension not found at ${EXTENSION_PATH}`);
    console.error('  Run: npm run build -w packages/extension');
    process.exit(1);
  }

  const edgeExe = findEdge();
  if (!edgeExe) {
    console.error('✗ msedge.exe not found in standard install paths');
    process.exit(1);
  }

  if (!opts.userDataDir) {
    if (opts.fresh) {
      opts.userDataDir = mkdtempSync(path.join(os.tmpdir(), 'edge-debug-fresh-'));
      console.log(`Using fresh temp profile: ${opts.userDataDir}`);
    } else {
      opts.userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
    }
  }

  if (!opts.fresh && isEdgeRunning()) {
    console.error('✗ Edge is already running. Close all Edge windows first, then re-run.');
    console.error('  (Edge enforces a single-instance lock on the user-data-dir.)');
    process.exit(1);
  }

  if (!(await isPortFree(opts.port))) {
    console.error(`✗ Port ${opts.port} is already in use. Pick another with --port.`);
    process.exit(1);
  }

  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.userDataDir}`,
    `--profile-directory=${opts.profile}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEnterpriseSiteList,msEnterpriseSiteListService,EnterpriseSiteListService,InternetExplorerIntegration',
    'about:blank',
  ];

  console.log('Edge        :', edgeExe);
  console.log('Profile dir :', opts.userDataDir);
  console.log('Profile name:', opts.profile);
  console.log('Debug port  :', opts.port);
  console.log('Extension   :', EXTENSION_PATH);
  console.log('');

  const proc = spawn(edgeExe, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout?.on('data', (d) => process.stdout.write(`[edge] ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`[edge] ${d}`));

  let cleanedUp = false;
  const cleanup = (exitCode = 0) => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
    } catch {
      // ignore
    }
    if (!proc.killed) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }
    process.exit(exitCode);
  };

  proc.on('exit', (code) => {
    console.log(`\n[edge] exited with code ${code}`);
    cleanup(code ?? 0);
  });
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  let info;
  try {
    info = await waitForDebugPort(opts.port);
  } catch (err) {
    console.error('✗', err.message);
    cleanup(1);
    return;
  }

  const state = {
    port: opts.port,
    webSocketDebuggerUrl: info.webSocketDebuggerUrl,
    browser: info.Browser,
    extensionPath: EXTENSION_PATH,
    userDataDir: opts.userDataDir,
    profile: opts.profile,
    pid: proc.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('');
  console.log(`✓ ${info.Browser} ready on port ${opts.port}`);
  console.log(`✓ State written to ${STATE_FILE}`);
  console.log('');
  console.log('Now run, in another terminal:');
  console.log('  npx playwright test --project=real-edge-via-cdp');
  console.log('');
  console.log('Press Ctrl+C (or close Edge) to stop.');
};

main().catch((err) => {
  console.error('✗ fatal:', err);
  process.exit(1);
});
