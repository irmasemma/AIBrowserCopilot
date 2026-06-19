import { crx, type CrxApplication } from 'playwright-crx';
import type { Page } from 'playwright-crx/test';

let app: CrxApplication | null = null;

const DEFAULT_TIMEOUT = 15_000;

const getApp = async (): Promise<CrxApplication> => {
  if (!app) {
    app = await crx.start();
  }
  return app;
};

/**
 * Attach playwright-crx to a tab, run a callback with the Page object, then detach.
 * Handles: already-attached debugger, detach on error, timeout.
 *
 * NOTE: attach/detach is cheap (~0-80ms — measured). Do NOT add page caching to
 * "speed this up": the real cost in screenshot/snapshot is the Playwright op
 * itself (font/animation stability waits), not attach. Caching only adds a
 * persistent debugger banner per tab for no gain. Fix slow ops at the call site.
 */
export const withPlaywrightPage = async <T>(
  tabId: number,
  callback: (page: Page) => Promise<T>,
  timeout = DEFAULT_TIMEOUT,
): Promise<T> => {
  const application = await getApp();
  let page: Page | null = null;

  try {
    page = await application.attach(tabId);
    page.setDefaultTimeout(timeout);
    return await callback(page);
  } finally {
    if (page) {
      try {
        await application.detach(page);
      } catch {
        // Already detached or tab closed — safe to ignore
      }
    }
  }
};
