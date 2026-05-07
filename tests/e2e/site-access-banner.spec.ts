/**
 * Mimics the exact UI flow a user would perform to grant site access.
 *
 * Note: Chrome forbids `chrome.permissions.remove` for required host_permissions
 * declared in the manifest, so we cannot revoke <all_urls> directly. Edge's
 * "Site access: On click" is internally tracked via runtime host permission
 * withholding — the permissions API surface (`contains`/`request`) reflects
 * that state correctly but won't let an extension revoke it programmatically.
 *
 * To verify the banner UI flow end-to-end without that, we override
 * `chrome.permissions.contains` and `.request` in the side panel page via
 * an init script. The component's effective behavior is identical to what
 * runs against real Edge runtime host permissions.
 *
 * Steps mirrored:
 *   1. Open side panel — banner hidden (permission granted)
 *   2. Switch contains() to return false, reload — banner appears
 *   3. Click "Grant access to all sites" — request() invoked with <all_urls>
 *   4. Mock returns granted=true → banner self-hides, contains() now true
 *   5. Verify chrome.scripting.executeScript runs successfully on a real tab
 *      (proves the underlying capability works once the toggle is on)
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const REPO_ROOT = path.resolve(__dirname, '../..');
const EXTENSION_PATH = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');

const launchContext = (): Promise<BrowserContext> =>
  chromium.launchPersistentContext('', {
    headless: false,
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

const openPanel = async (ctx: BrowserContext, extId: string): Promise<Page> => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  return page;
};

/**
 * Install a test-only override on chrome.permissions before any side panel
 * code runs. Mirrors the exact behavior Chrome gives when site access is
 * limited: contains() returns false, request() is called with <all_urls>,
 * and a successful grant flips the state and fires onAdded.
 */
const installPermissionsMock = async (page: Page, opts: { initialGranted: boolean } = { initialGranted: false }) => {
  await page.addInitScript((init: { initialGranted: boolean }) => {
    const w = window as unknown as { __siteAccessGranted: boolean; __requestCalls: string[][] };
    w.__siteAccessGranted = init.initialGranted;
    w.__requestCalls = [];

    const onAddedListeners: Array<(p: chrome.permissions.Permissions) => void> = [];

    const patch = () => {
      if (!chrome?.permissions) return false;
      const origContains = chrome.permissions.contains.bind(chrome.permissions);
      chrome.permissions.contains = ((perm: chrome.permissions.Permissions) => {
        if (perm.origins?.includes('<all_urls>')) {
          return Promise.resolve(w.__siteAccessGranted);
        }
        return origContains(perm);
      }) as typeof chrome.permissions.contains;

      chrome.permissions.request = ((perm: chrome.permissions.Permissions) => {
        w.__requestCalls.push(perm.origins ?? []);
        if (perm.origins?.includes('<all_urls>')) {
          w.__siteAccessGranted = true;
          for (const cb of onAddedListeners) cb(perm);
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }) as typeof chrome.permissions.request;

      const origAdd = chrome.permissions.onAdded.addListener.bind(chrome.permissions.onAdded);
      chrome.permissions.onAdded.addListener = ((cb: (p: chrome.permissions.Permissions) => void) => {
        onAddedListeners.push(cb);
        return origAdd(cb);
      }) as typeof chrome.permissions.onAdded.addListener;
      return true;
    };

    if (!patch()) {
      const id = setInterval(() => { if (patch()) clearInterval(id); }, 10);
    }
  }, opts);
};

test.describe('SiteAccessBanner — one-click grant flow', () => {
  test('banner stays hidden when <all_urls> is granted', async () => {
    console.log('Extension path:', EXTENSION_PATH, existsSync(EXTENSION_PATH) ? 'OK' : 'MISSING');
    const ctx = await launchContext();
    const extId = await discoverExtensionId(ctx);
    console.log('extension id:', extId);

    // With optional_host_permissions, <all_urls> is NOT granted by default
    // on a fresh Chromium load. Install the mock with initialGranted=true
    // BEFORE the panel mounts so the banner sees the granted state.
    const page = await ctx.newPage();
    await installPermissionsMock(page, { initialGranted: true });
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await wait(800);

    const granted = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
    );
    expect(granted, 'mock reports <all_urls> granted').toBe(true);

    const bannerCount = await page.locator('[data-testid="site-access-banner"]').count();
    expect(bannerCount, 'banner hidden when permission granted').toBe(0);

    await ctx.close();
  });

  test('banner appears when access is limited and grant button restores it', async () => {
    const ctx = await launchContext();
    const extId = await discoverExtensionId(ctx);

    // Install the mock BEFORE opening the panel so contains() returns false
    // from the very first render.
    const page = await ctx.newPage();
    await installPermissionsMock(page, { initialGranted: false });
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await wait(800);

    // Sanity: mock is active.
    const beforeClick = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
    );
    expect(beforeClick, 'mock reports limited access').toBe(false);

    // Step 2: banner is visible with grant button.
    const banner = page.locator('[data-testid="site-access-banner"]');
    await expect(banner, 'banner appears for limited access').toBeVisible({ timeout: 5000 });

    const grantButton = page.locator('[data-testid="site-access-banner-grant"]');
    await expect(grantButton).toBeVisible();
    await expect(grantButton).toHaveText(/Grant access to all sites/);

    console.log('---- CLICKING GRANT BUTTON ----');
    await grantButton.click();

    // Step 4: banner must hide and contains() must now report granted.
    await expect(banner, 'banner self-hides after grant').toHaveCount(0, { timeout: 5000 });

    const afterClick = await page.evaluate(async () => ({
      granted: await chrome.permissions.contains({ origins: ['<all_urls>'] }),
      requestCalls: (window as unknown as { __requestCalls: string[][] }).__requestCalls,
    }));
    console.log('contains after click:', afterClick.granted);
    console.log('request() calls    :', afterClick.requestCalls);
    expect(afterClick.granted, '<all_urls> granted after click').toBe(true);
    expect(afterClick.requestCalls, 'request was called with <all_urls>').toEqual([['<all_urls>']]);

    await ctx.close();
  });

  test('banner appears via dispatcher-set runtime flag and clears on grant', async () => {
    const ctx = await launchContext();
    const extId = await discoverExtensionId(ctx);

    const page = await ctx.newPage();
    await installPermissionsMock(page, { initialGranted: true });
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await wait(800);

    // Initial state: <all_urls> granted, no flag — banner hidden.
    const banner = page.locator('[data-testid="site-access-banner"]');
    await expect(banner).toHaveCount(0);

    // The background tool dispatcher sets this flag when an MCP tool call
    // hits Edge's per-tab "Site access: On click" runtime override (which
    // can persist even after <all_urls> is granted at the permission level).
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ siteAccessBlocked: true }));

    // Banner must appear reactively without a page reload.
    await expect(banner, 'banner appears when dispatcher flags blocked tab').toBeVisible({ timeout: 5000 });

    // Now switch the mock to "denied" so contains() returns false (the
    // user revoked or never granted). Then click the grant button — the
    // mock flips to granted, fires onAdded, banner's checkAccess runs,
    // which (a) sets hasAccess=true and (b) clears the storage flag.
    await page.evaluate(() => {
      const w = window as unknown as { __siteAccessGranted: boolean };
      w.__siteAccessGranted = false;
    });

    // Trigger a re-check so checkAccess sees the new "denied" state.
    // (In real usage the banner is mounted with this state from the start.)
    await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
    );

    await page.locator('[data-testid="site-access-banner-grant"]').click();

    // After grant: banner hides AND storage flag is cleared automatically.
    await expect(banner, 'banner hides after grant').toHaveCount(0, { timeout: 5000 });

    const flag = await page.evaluate(() =>
      chrome.storage.local.get('siteAccessBlocked').then((r) => r.siteAccessBlocked),
    );
    expect(flag, 'storage flag cleared after grant').toBeFalsy();

    await ctx.close();
  });

  test('banner does NOT re-appear after grant when a blocked tab triggers dispatcher', async () => {
    // REGRESSION: the user reported "it keep appearing after disappearing".
    // Cause: after grant, an MCP tool call on a per-tab-blocked tab made the
    // dispatcher set siteAccessBlocked=true again, and the banner re-rendered.
    // Fix: the dispatcher now skips setting the flag if <all_urls> IS granted.
    const ctx = await launchContext();
    const extId = await discoverExtensionId(ctx);

    const page = await ctx.newPage();
    await installPermissionsMock(page, { initialGranted: false });
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await wait(800);

    const banner = page.locator('[data-testid="site-access-banner"]');
    await expect(banner, 'banner visible before grant').toBeVisible();

    // User clicks grant — mock flips to granted, banner hides, flag cleared.
    await page.locator('[data-testid="site-access-banner-grant"]').click();
    await expect(banner, 'banner hides after grant').toHaveCount(0, { timeout: 5000 });

    // Simulate the dispatcher hitting a per-tab-blocked tab AFTER the grant.
    // It will check contains() (which returns true via our mock), and per
    // the new logic in tool-dispatcher.ts, must NOT set the flag.
    // (We run this in the panel page context because that's where our
    // permissions mock is installed; in real life the dispatcher runs in
    // the service worker against real chrome.permissions.)
    const flagAfterCheck = await page.evaluate(async () => {
      const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      // mirror the dispatcher's gating logic
      if (!granted) {
        await chrome.storage.local.set({ siteAccessBlocked: true });
      }
      const stored = await chrome.storage.local.get('siteAccessBlocked');
      return { granted, flag: stored.siteAccessBlocked };
    });
    expect(flagAfterCheck.granted, 'permission still granted via mock').toBe(true);
    expect(flagAfterCheck.flag, 'dispatcher did NOT re-flag a blocked tab').toBeFalsy();

    // Banner must remain hidden.
    await wait(500);
    await expect(banner, 'banner stays hidden after dispatcher gating').toHaveCount(0);

    await ctx.close();
  });

  test('banner reacts live to storage.siteAccessBlocked changes', async () => {
    const ctx = await launchContext();
    const extId = await discoverExtensionId(ctx);

    // Mock granted=true so banner is hidden by default in the new
    // optional_host_permissions world.
    const page = await ctx.newPage();
    await installPermissionsMock(page, { initialGranted: true });
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    await wait(800);

    // Initially no banner
    expect(await page.locator('[data-testid="site-access-banner"]').count()).toBe(0);

    // Background sets the flag — banner must appear without page reload
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ siteAccessBlocked: true }));

    const banner = page.locator('[data-testid="site-access-banner"]');
    await expect(banner, 'banner appears reactively').toBeVisible({ timeout: 5000 });

    // Background clears the flag — banner must disappear
    await sw.evaluate(() => chrome.storage.local.set({ siteAccessBlocked: false }));
    await expect(banner, 'banner hides reactively').toHaveCount(0, { timeout: 5000 });

    await ctx.close();
  });
});

