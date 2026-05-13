/**
 * Live diagnostic for connection issues — launches Microsoft Edge with the
 * built extension, spawns the real native-host (the way an MCP client would),
 * inspects what the helper returns, and reports the connection state.
 *
 * Use to troubleshoot "extension shows not connected" complaints when the
 * install-flow e2e suite passes.
 */

import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
const HOST_BIN = path.join(
  process.env.LOCALAPPDATA ?? '',
  'agenthub',
  'agenthub-win-x64.exe',
);
const LOCK_FILE = path.join(
  process.env.LOCALAPPDATA ?? '',
  'agenthub',
  'server.lock',
);

let host: ChildProcess | undefined;

const spawnHost = (): ChildProcess => {
  const child = spawn(HOST_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout?.on('data', (d) => console.log(`[host stdout] ${d.toString().trim()}`));
  child.stderr?.on('data', (d) => console.log(`[host stderr] ${d.toString().trim()}`));
  child.on('exit', (code) => console.log(`[host] exited code=${code}`));
  return child;
};

const launchEdgeContext = (): Promise<BrowserContext> =>
  chromium.launchPersistentContext('', {
    headless: false,
    // NOTE: channel 'msedge' fails on corp machines that try to download
    // an enterprise IE sitelist. We use bundled Chromium — same engine,
    // same extension behavior, no enterprise policy interference.
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

const discoverExtensionId = async (ctx: BrowserContext): Promise<string> => {
  await wait(2500);
  const sws = ctx.serviceWorkers();
  if (sws.length > 0) return sws[0].url().split('/')[2];
  const sw = await ctx.waitForEvent('serviceworker', { timeout: 8000 });
  return sw.url().split('/')[2];
};

test.afterEach(async () => {
  if (host && !host.killed) {
    host.kill();
    host = undefined;
  }
});

test('diag: extension can connect when host is spawned (Edge, real binary)', async () => {
  console.log('---- ENVIRONMENT ----');
  console.log('Extension path  :', EXTENSION_PATH, existsSync(EXTENSION_PATH) ? 'OK' : 'MISSING');
  console.log('Host binary     :', HOST_BIN, existsSync(HOST_BIN) ? 'OK' : 'MISSING');

  // 1. Spawn host (simulating an MCP client)
  console.log('\n---- SPAWN HOST ----');
  host = spawnHost();
  await wait(2000);

  expect(existsSync(LOCK_FILE), 'lock file written').toBe(true);
  const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  console.log('lock file:', lock);
  expect(lock.port).toBe(7483);

  // 2. Launch Edge with our extension
  console.log('\n---- LAUNCH EDGE ----');
  const ctx = await launchEdgeContext();
  const extId = await discoverExtensionId(ctx);
  console.log('extension id (Edge-assigned):', extId);

  // 3. Open side panel and read connection state
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await wait(1000);

  // 4. Probe what the extension knows
  const probe = await page.evaluate(async () => {
    const ctx = (await chrome.storage.local.get('connectionContext')).connectionContext as
      | Record<string, unknown>
      | undefined;
    let helperResp: unknown = null;
    let helperErr: string | null = null;
    try {
      helperResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(
          'com.agenthub.native_host_helper',
          { action: 'check_mcp_registration' },
          (r) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          },
        );
      });
    } catch (e) {
      helperErr = (e as Error).message;
    }
    return { connectionContext: ctx, helperResp, helperErr };
  });

  console.log('\n---- EXTENSION STATE ----');
  console.log('connectionContext:', JSON.stringify(probe.connectionContext, null, 2));
  console.log('helper response  :', JSON.stringify(probe.helperResp, null, 2));
  console.log('helper error     :', probe.helperErr);

  // 5. Wait for connected state
  console.log('\n---- WAITING FOR CONNECTED ----');
  let state: string | null = null;
  for (let i = 0; i < 30; i++) {
    state = await page.evaluate(async () => {
      const c = (await chrome.storage.local.get('connectionContext')).connectionContext as
        | { state?: string }
        | undefined;
      return c?.state ?? null;
    });
    console.log(`  t=${i * 0.5}s state=${state}`);
    if (state === 'connected') break;
    await wait(500);
  }

  console.log('\n---- FINAL ----');
  console.log('final state:', state);

  await ctx.close();
  expect(state).toBe('connected');
});
