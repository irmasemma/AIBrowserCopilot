/**
 * One-off: launch Edge with the freshly-built unpacked extension and screenshot
 * the side panel in three states (Chat empty, Tools, Settings).
 *
 * Run: AGENTHUB_TEST_KILL_CHROME=1 node tests/e2e/screenshots-real.mjs
 */
import { chromium } from '@playwright/test';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const EXT_DIST = path.join(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
const OUT_DIR = path.join(__dirname, '../../packages/extension/store-screenshots/out-real');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DATA_DIR = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Edge', 'User Data');
const JUNCTION = path.join(os.tmpdir(), 'copilot-real-edge-userdata');
const EXT_ID = 'ehchmchlmggdigicfjfmlgcbhdcdcmll';

mkdirSync(OUT_DIR, { recursive: true });

const killAllEdge = () => {
  try { execSync('taskkill /IM msedge.exe /F', { stdio: 'ignore', timeout: 10_000 }); } catch {}
  // Wait for lock to release
  for (let i = 0; i < 40; i++) {
    const r = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq msedge.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf-8' });
    if (!/msedge\.exe/i.test(r.stdout)) return;
    execSync('cmd /c "ping -n 1 127.0.0.1 >nul"', { stdio: 'ignore' });
  }
};

const ensureJunction = () => {
  if (existsSync(JUNCTION)) {
    if (lstatSync(JUNCTION).isSymbolicLink()) return;
    throw new Error(`${JUNCTION} exists but is not a junction`);
  }
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', JUNCTION, USER_DATA_DIR], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`mklink failed: ${r.stderr}`);
};

const main = async () => {
  killAllEdge();
  ensureJunction();

  // First launch just to flip Developer Mode (then close).
  const bootstrap = await chromium.launchPersistentContext(JUNCTION, {
    executablePath: EDGE,
    headless: false,
    args: ['--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    timeout: 60_000,
  });
  try {
    const page = await bootstrap.newPage();
    await page.goto('edge://extensions/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const walk = (root) => {
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          for (const el of Array.from(node.querySelectorAll('*'))) {
            if (el.id === 'devMode' || el.id === 'developer-mode') return el;
            if (el.shadowRoot) stack.push(el.shadowRoot);
          }
        }
        return null;
      };
      for (let i = 0; i < 20; i++) {
        const t = walk(document);
        if (t) {
          const on = t.checked ?? t.getAttribute('aria-pressed') === 'true';
          if (!on) t.click();
          return;
        }
        await sleep(150);
      }
    });
    await wait(1500);
  } finally {
    await bootstrap.close().catch(() => {});
  }
  killAllEdge();

  // Real launch with the extension loaded.
  const ctx = await chromium.launchPersistentContext(JUNCTION, {
    executablePath: EDGE,
    headless: false,
    args: [
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
      `--load-extension=${EXT_DIST}`,
      `--disable-extensions-except=${EXT_DIST}`,
    ],
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    timeout: 60_000,
    viewport: { width: 400, height: 800 },
  });

  try {
    // Wake the service worker
    const wake = await ctx.newPage();
    await wake.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await wait(2000);
    await wake.close();

    const panel = await ctx.newPage();
    await panel.setViewportSize({ width: 400, height: 800 });
    await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await panel.evaluate(() => chrome.storage.local.set({ setupComplete: true }));
    await panel.reload({ waitUntil: 'domcontentloaded' });
    await panel.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    // Wait for Connected (bridge should be up from the earlier install)
    for (let i = 0; i < 30; i++) {
      const label = await panel.locator('[data-testid="status-badge"]').first().getAttribute('data-label');
      if (label === 'Connected') break;
      await wait(500);
    }

    // Screenshot: Chat (empty)
    await panel.locator('[role="tab"][aria-selected]').filter({ hasText: 'Chat' }).first().click().catch(() => {});
    await wait(500);
    await panel.screenshot({ path: path.join(OUT_DIR, '01-real-chat.png') });
    console.log('wrote 01-real-chat.png');

    // Screenshot: Tools (scroll the inner container so the dark activity log is visible)
    await panel.getByRole('tab', { name: 'Tools' }).click();
    await wait(500);
    await panel.screenshot({ path: path.join(OUT_DIR, '02-real-tools.png') });
    console.log('wrote 02-real-tools.png');
    // Scroll the Tools panel to the bottom and re-shot
    await panel.evaluate(() => {
      const scrollable = document.querySelector('.h-full.overflow-y-auto');
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await wait(400);
    await panel.screenshot({ path: path.join(OUT_DIR, '02b-real-tools-log.png') });
    console.log('wrote 02b-real-tools-log.png');

    // Screenshot: Settings
    await panel.getByRole('tab', { name: 'Settings' }).click();
    await wait(500);
    await panel.screenshot({ path: path.join(OUT_DIR, '03-real-settings.png') });
    console.log('wrote 03-real-settings.png');
  } finally {
    await ctx.close().catch(() => {});
    killAllEdge();
  }
};

main().catch((err) => { console.error(err); process.exit(1); });
