/**
 * Install / Refresh / Setup Lifecycle — UI smoke tests.
 *
 * Drives the side panel UI directly via chrome.storage to verify the wizard
 * + ConnectionHeader render the right text for each state. For deeper
 * coverage of the actual install/uninstall/reconnect flows with a real
 * installer + real bridge, see install-and-connect.spec.ts and
 * install-and-chat.spec.ts.
 *
 * Earlier this file contained ~50 tests written against an older state
 * shape (connectionState with a `'setup-needed'` enum value) and older
 * wizard text ("Setup Assistant", "Setup Required" badge). Both were
 * removed during refactors. This is the surgically-migrated subset.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import type {
  ConnectionContext,
  ConnectionState,
  DiagnosticReason,
} from '../../packages/extension/src/shared/types';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');

const launchContext = async (): Promise<BrowserContext> =>
  chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

const discoverExtensionId = async (ctx: BrowserContext): Promise<string> => {
  await new Promise((r) => setTimeout(r, 3000));
  const sws = ctx.serviceWorkers();
  if (sws.length > 0) return sws[0].url().split('/')[2];
  try {
    const sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 });
    return sw.url().split('/')[2];
  } catch { /* fall through */ }
  const bgs = ctx.backgroundPages();
  if (bgs.length > 0) return bgs[0].url().split('/')[2];
  throw new Error('Could not discover extension ID');
};

const openSidePanel = async (ctx: BrowserContext, extId: string): Promise<Page> => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });
  return page;
};

/**
 * Force the side panel into a specific connection state by writing the
 * full ConnectionContext into chrome.storage.local and reloading. Mirrors
 * what the background worker would push on a real state change.
 */
const setConnectionContext = async (page: Page, ctx: Partial<ConnectionContext>): Promise<void> => {
  const full: ConnectionContext = {
    state: 'disconnected' as ConnectionState,
    failureCount: 0,
    missedHeartbeats: 0,
    lastConnectedAt: null,
    serverInfo: null,
    error: null,
    reconnectsThisSession: 0,
    diagnosticReason: null as DiagnosticReason | null,
    lastVerifiedAt: 0,
    versionStatus: null,
    ...ctx,
  };
  await page.evaluate((c) => chrome.storage.local.set({ connectionContext: c }), full);
  await page.waitForTimeout(300);
};

const setSetupComplete = async (page: Page, complete: boolean): Promise<void> => {
  if (complete) {
    await page.evaluate(() => chrome.storage.local.set({ setupComplete: true }));
  } else {
    await page.evaluate(() => chrome.storage.local.remove(['setupComplete']));
  }
  await page.waitForTimeout(150);
};

const clearAllStorage = async (page: Page): Promise<void> => {
  await page.evaluate(() => chrome.storage.local.clear());
  await page.waitForTimeout(200);
};

// ============================================================================
// SUITE 1 — Setup wizard surface on first load
// ============================================================================

test.describe('SetupWizard surface', () => {
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await launchContext();
    extensionId = await discoverExtensionId(context);
    // Block verify_connection at the chrome.runtime.sendMessage layer.
    // ConnectionHeader fires this on mount; the SW honours it and (when
    // a real bridge is autostarted on this machine) overwrites our fake
    // connectionContext with state='connected', which hides the
    // SetupWizard before our assertions can run. Same shape as the
    // ConnectionHeader-state-transitions describe block below.
    await context.addInitScript(() => {
      const orig = chrome.runtime?.sendMessage;
      if (orig) {
        // @ts-expect-error overload override
        chrome.runtime.sendMessage = function (msg: unknown, ...rest: unknown[]) {
          if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'verify_connection') {
            return Promise.resolve(undefined);
          }
          // @ts-expect-error spread original signature
          return orig.call(chrome.runtime, msg, ...rest);
        };
      }
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('1.1 Side panel shows SetupWizard on first load (no setupComplete, no prior connection)', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearAllStorage(page);
    await setConnectionContext(page, {
      state: 'disconnected',
      lastConnectedAt: null,
      diagnosticReason: 'helper_unavailable',
    });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    const body = (await page.textContent('body')) ?? '';
    expect(body).toContain('Welcome to AgentHub');
    expect(body).toContain('Run Setup');
    expect(body).toContain('Open Your AI Tool');

    await page.close();
  });

  test('1.2 Setup wizard shows correct npx command with extension ID', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearAllStorage(page);
    await setConnectionContext(page, { state: 'disconnected', diagnosticReason: 'helper_unavailable' });
    await page.reload();
    await page.waitForSelector('pre', { timeout: 10_000 });

    const commandBlock = await page.locator('pre').first().textContent();
    expect(commandBlock).toContain('npx agenthub-setup');
    expect(commandBlock).toContain('--extension-id');
    expect(commandBlock).toContain(extensionId);

    await page.close();
  });

  test('1.3 Setup wizard Copy button works and confirms', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearAllStorage(page);
    await setConnectionContext(page, { state: 'disconnected', diagnosticReason: 'helper_unavailable' });
    // Stub navigator.clipboard.writeText so handleCopy resolves in test mode.
    // grantPermissions doesn't work for opaque chrome-extension:// origins, and
    // headless browsers don't expose the real clipboard API.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (_: string) => undefined, readText: async () => '' },
      });
    });
    await page.reload();
    await page.waitForSelector('pre', { timeout: 10_000 });

    // Scope to the SetupWizard's Copy button — auto-opened DiagnosticsPanel
    // also has Copy buttons (one per failed step) when helper_unavailable, so a
    // page-wide getByRole('button', { name: 'Copy' }) is ambiguous.
    const wizardCopyBtn = page
      .locator('div.relative', {
        has: page.locator('pre', { hasText: 'npx agenthub-setup' }),
      })
      .getByRole('button', { name: 'Copy' })
      .first();
    await expect(wizardCopyBtn).toBeVisible({ timeout: 5_000 });
    await wizardCopyBtn.click();
    await expect(page.getByText(/Copied/).first()).toBeVisible({ timeout: 2_000 });

    await page.close();
  });

  test('1.4 Setup wizard shows Node.js requirement', async () => {
    const page = await openSidePanel(context, extensionId);
    await clearAllStorage(page);
    await setConnectionContext(page, { state: 'disconnected', diagnosticReason: 'helper_unavailable' });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    const body = (await page.textContent('body')) ?? '';
    expect(body).toContain('Node.js 18+');

    await page.close();
  });
});

// ============================================================================
// SUITE 2 — ConnectionHeader state transitions
// ============================================================================

test.describe('ConnectionHeader state transitions', () => {
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    context = await launchContext();
    extensionId = await discoverExtensionId(context);
    // Block verify_connection: ConnectionHeader fires it on mount and the SW
    // would overwrite our fake connectionContext with a real broken state
    // (no bridge actually running). Intercept it before any page loads.
    await context.addInitScript(() => {
      const orig = chrome.runtime?.sendMessage;
      if (orig) {
        // @ts-expect-error overload override
        chrome.runtime.sendMessage = function (msg: unknown, ...rest: unknown[]) {
          if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'verify_connection') {
            return Promise.resolve(undefined);
          }
          // @ts-expect-error spread original signature
          return orig.call(chrome.runtime, msg, ...rest);
        };
      }
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('2.1 Connected state shows "Connected" title + green status badge', async () => {
    const page = await openSidePanel(context, extensionId);
    await setSetupComplete(page, true);
    await setConnectionContext(page, {
      state: 'connected',
      lastConnectedAt: Date.now(),
      serverInfo: { pid: 1, port: 7483, version: '0.5.0', buildId: 'test', startedBy: 'vscode', capabilities: [], uptime: 0 },
    });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    const title = await page
      .locator('[data-testid="connection-header-title"]')
      .first()
      .textContent();
    expect(title?.trim()).toBe('Connected');

    const badgeState = await page
      .locator('[data-testid="status-badge"]')
      .first()
      .getAttribute('data-state');
    expect(badgeState).toBe('connected');

    await page.close();
  });

  test('2.2 No-lock-file state shows "Bridge isn’t running" + Start service button', async () => {
    const page = await openSidePanel(context, extensionId);
    await setSetupComplete(page, true);
    await setConnectionContext(page, {
      state: 'disconnected',
      diagnosticReason: 'no_lock_file',
    });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    const title = await page
      .locator('[data-testid="connection-header-title"]')
      .first()
      .textContent();
    expect(title).toContain("Bridge isn");

    await expect(
      page.getByRole('button', { name: /Start AgentHub service/i }),
    ).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('2.3 disconnected → connected transition updates header live', async () => {
    const page = await openSidePanel(context, extensionId);
    await setSetupComplete(page, true);
    await setConnectionContext(page, {
      state: 'disconnected',
      diagnosticReason: 'no_lock_file',
    });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    // Confirm initial broken state
    const initialTitle = await page
      .locator('[data-testid="connection-header-title"]')
      .first()
      .textContent();
    expect(initialTitle).not.toBe('Connected');

    // Live-update via storage; no reload — the storage listener should
    // pick it up and re-render.
    await setConnectionContext(page, {
      state: 'connected',
      lastConnectedAt: Date.now(),
      serverInfo: { pid: 1, port: 7483, version: '0.5.0', buildId: 'test', startedBy: 'vscode', capabilities: [], uptime: 0 },
    });

    await expect(
      page.locator('[data-testid="connection-header-title"]').first(),
    ).toHaveText('Connected', { timeout: 5_000 });

    await page.close();
  });

  test('2.4 Connected state survives side panel reload', async () => {
    const page = await openSidePanel(context, extensionId);
    await setSetupComplete(page, true);
    await setConnectionContext(page, {
      state: 'connected',
      lastConnectedAt: Date.now(),
      serverInfo: { pid: 1, port: 7483, version: '0.5.0', buildId: 'test', startedBy: 'cursor', capabilities: [], uptime: 0 },
    });
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });

    // First read after reload — should be connected from storage on mount.
    await expect(
      page.locator('[data-testid="connection-header-title"]').first(),
    ).toHaveText('Connected', { timeout: 5_000 });

    // Reload again — Connected should stay (it's in storage).
    await page.reload();
    await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="connection-header-title"]').first(),
    ).toHaveText('Connected', { timeout: 5_000 });

    await page.close();
  });
});

// ============================================================================
// SUITE 3 — Service worker presence
// ============================================================================

test.describe('Service worker', () => {
  test('3.1 Service worker is registered after extension loads', async () => {
    const context = await launchContext();
    try {
      await discoverExtensionId(context); // wakes the SW
      const sws = context.serviceWorkers();
      expect(sws.length).toBeGreaterThan(0);
      expect(sws[0].url()).toMatch(/^chrome-extension:\/\/[a-z]+\/background\.js$/);
    } finally {
      await context.close();
    }
  });
});
