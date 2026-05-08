/**
 * Verifies the side-panel grant-access banner flow in the user's REAL Edge.
 *
 * The banner only appears when the extension does NOT have <all_urls>. Because
 * we're running against the user's real profile, the permission state is
 * persistent — so this test handles both states deterministically:
 *
 *   - if access NOT granted     → assert banner visible, click grant, assert it disappears
 *   - if access ALREADY granted → assert banner hidden, log a clear "skipped flow" notice
 *
 * Prereq: launch Edge first with `npm run edge:debug`.
 */
import { test, expect } from '@playwright/test';
import { attachToRealEdge, openSidePanel } from './helpers/connect-real-edge';

test('real Edge: side panel renders and grant-access flow works end-to-end', async () => {
  const edge = await attachToRealEdge();
  const page = await openSidePanel(edge.context, edge.extensionId);
  try {
    const banner = page.locator('[data-testid="site-access-banner"]');

    const granted = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
    );

    if (granted) {
      // Banner must be hidden when access is already granted.
      await expect(banner, 'banner hidden when already granted').toHaveCount(0, { timeout: 5000 });
      console.log('ℹ <all_urls> already granted in this profile — grant-flow path not exercised.');
      // Still verify the side panel is alive and rendering its main shell.
      await expect(page.locator('body')).toContainText(/Connected/i, { timeout: 10000 });
      return;
    }

    // Access not granted yet — banner must be visible.
    await expect(banner, 'banner visible when access not granted').toBeVisible({ timeout: 5000 });

    // Stub chrome.permissions to simulate an "Allow" click on the OS prompt
    // (the OS-level dialog is a security boundary automation cannot click).
    // contains() flips when request() is called — same as Edge's real behavior.
    await page.evaluate(() => {
      const w = window as unknown as { __siteAccessGranted: boolean };
      w.__siteAccessGranted = false;
      const realContains = chrome.permissions.contains.bind(chrome.permissions);
      chrome.permissions.contains = ((perm: chrome.permissions.Permissions) => {
        if (perm.origins?.includes('<all_urls>')) return Promise.resolve(w.__siteAccessGranted);
        return realContains(perm);
      }) as typeof chrome.permissions.contains;
      chrome.permissions.request = ((perm: chrome.permissions.Permissions) => {
        if (perm.origins?.includes('<all_urls>')) w.__siteAccessGranted = true;
        return Promise.resolve(true);
      }) as typeof chrome.permissions.request;
    });

    await page.locator('[data-testid="site-access-banner-grant"]').click();
    await expect(banner, 'banner hides after grant').toHaveCount(0, { timeout: 5000 });

    // Stays hidden through 3s — the regression we already fixed once.
    await page.waitForTimeout(3000);
    await expect(banner, 'banner stays hidden 3s later').toHaveCount(0);
  } finally {
    await page.close().catch(() => {});
    await edge.browser.close().catch(() => {});
  }
});
