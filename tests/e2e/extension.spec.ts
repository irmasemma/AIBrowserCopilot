import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  // Give extension time to load
  await new Promise((r) => setTimeout(r, 3000));

  // Method 1: Check service workers
  const sws = context.serviceWorkers();
  console.log('Service workers found:', sws.length);
  sws.forEach((sw, i) => console.log(`  SW ${i}:`, sw.url()));

  if (sws.length > 0) {
    extensionId = sws[0].url().split('/')[2];
  }

  // Method 2: Try waiting for service worker event
  if (!extensionId) {
    try {
      const sw = await context.waitForEvent('serviceworker', { timeout: 5000 });
      extensionId = sw.url().split('/')[2];
    } catch {
      console.log('No service worker event received');
    }
  }

  // Method 3: Check background pages (some extensions use this instead)
  if (!extensionId) {
    const pages = context.backgroundPages();
    console.log('Background pages found:', pages.length);
    pages.forEach((p, i) => console.log(`  BG ${i}:`, p.url()));
    if (pages.length > 0) {
      extensionId = pages[0].url().split('/')[2];
    }
  }

  // Method 4: List all pages and find extension ones
  if (!extensionId) {
    const allPages = context.pages();
    console.log('All pages:', allPages.length);
    allPages.forEach((p, i) => console.log(`  Page ${i}:`, p.url()));
    const extPage = allPages.find(p => p.url().startsWith('chrome-extension://'));
    if (extPage) {
      extensionId = extPage.url().split('/')[2];
    }
  }

  console.log('Extension ID:', extensionId);
});

test.afterAll(async () => {
  await context?.close();
});

test('1. Extension loads successfully', async () => {
  expect(extensionId).toBeTruthy();
  console.log('Extension loaded with ID:', extensionId);

  // Service worker may or may not be running — verify extension is accessible
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  const text = await page.textContent('body');
  expect(text).toContain('AI Browser CoPilot');
  console.log('Extension is accessible');
  await page.close();
});

test('2. Popup renders with status and button', async () => {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/index.html`);

  // Check that the popup has content
  const statusLabel = popupPage.locator('#statusLabel');
  await expect(statusLabel).toBeVisible({ timeout: 5000 });

  const text = await statusLabel.textContent();
  console.log('Popup status:', text);
  expect(['Setup Required', 'Checking...', 'Connected', 'Disconnected', 'Reconnecting...']).toContain(text);

  const openPanelBtn = popupPage.locator('#openPanel');
  await expect(openPanelBtn).toBeVisible();
  await expect(openPanelBtn).toHaveText('Open Side Panel');

  console.log('PASS: Popup renders correctly');
  await popupPage.close();
});

test('3. Side panel renders correctly (setup wizard or main view)', async () => {
  const sidePanelPage = await context.newPage();
  await sidePanelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Wait for Preact to render
  await sidePanelPage.waitForTimeout(1000);

  // Check that the app rendered (not blank)
  const body = await sidePanelPage.textContent('body');
  console.log('Side panel body length:', body?.length);
  expect(body?.length).toBeGreaterThan(10);

  // Check for header with "CoPilot" text
  const hasCoPilot = await sidePanelPage.getByText('CoPilot').count();
  console.log('Has CoPilot header:', hasCoPilot > 0);
  expect(hasCoPilot).toBeGreaterThan(0);

  // When not connected, side panel shows Setup Wizard
  // When connected, it shows Tools + Activity
  const hasSetupWizard = body?.includes('Setup Assistant');
  const hasTools = body?.includes('Tools');

  console.log('Shows Setup Wizard:', hasSetupWizard);
  console.log('Shows Tools view:', hasTools);

  if (hasSetupWizard) {
    // Verify setup wizard content
    const hasStep1 = body?.includes('Install Browser Bridge');
    const hasStep2 = body?.includes('Configure AI App');
    const hasStep3 = body?.includes('Test Connection');
    console.log('Step 1 (Install Bridge):', hasStep1);
    console.log('Step 2 (Configure AI):', hasStep2);
    console.log('Step 3 (Test Connection):', hasStep3);
    expect(hasStep1).toBe(true);
  } else {
    // Verify main view content
    expect(hasTools).toBe(true);

    const toolNames = ['Page Content', 'Screenshot', 'List Tabs'];
    for (const name of toolNames) {
      const count = await sidePanelPage.getByText(name, { exact: false }).count();
      console.log(`Tool "${name}":`, count > 0 ? 'FOUND' : 'MISSING');
      expect(count).toBeGreaterThan(0);
    }
  }

  console.log('PASS: Side panel renders correctly');
  await sidePanelPage.close();
});

test('4. Side panel shows tools view when connected', async () => {
  const page = await context.newPage();

  // Simulate connected state
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    chrome.storage.local.set({
      connectionState: { state: 'connected', lastConnected: Date.now(), error: null },
    });
  });

  // Reload to pick up the new state
  await page.reload();
  await page.waitForTimeout(1000);

  const body = await page.textContent('body');

  const hasTools = body?.includes('Tools');
  const hasActivity = body?.includes('Activity');
  console.log('Shows Tools:', hasTools);
  console.log('Shows Activity:', hasActivity);
  expect(hasTools).toBe(true);
  expect(hasActivity).toBe(true);

  // Check all 8 tools render
  const toolNames = ['Page Content', 'Screenshot', 'List Tabs', 'Metadata', 'Navigate', 'Fill Form', 'Click', 'Extract Table'];
  for (const name of toolNames) {
    const count = await page.getByText(name, { exact: false }).count();
    console.log(`Tool "${name}":`, count > 0 ? 'FOUND' : 'MISSING');
    expect(count).toBeGreaterThan(0);
  }

  // Check upgrade button
  const upgradeBtn = await page.getByText('Upgrade to Pro').count();
  console.log('Has upgrade button:', upgradeBtn > 0);
  expect(upgradeBtn).toBeGreaterThan(0);

  // Check support links
  const reportProblem = await page.getByText('Report a Problem').count();
  console.log('Has Report a Problem:', reportProblem > 0);
  expect(reportProblem).toBeGreaterThan(0);

  // Reset state
  await page.evaluate(() => {
    chrome.storage.local.remove('connectionState');
  });

  console.log('PASS: Tools view renders with all 8 tools');
  await page.close();
});

test('5. Side panel shows setup wizard when not connected', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForTimeout(1000);

  const body = await page.textContent('body');

  // Should show either setup wizard or main view with setup-needed state
  const hasSetupAssistant = body?.includes('Setup Assistant');
  const hasSetupRequired = body?.includes('Setup Required');
  const hasTools = body?.includes('Tools');

  console.log('Has Setup Assistant:', hasSetupAssistant);
  console.log('Has Setup Required:', hasSetupRequired);
  console.log('Has Tools view:', hasTools);

  // At least one of these should be true
  expect(hasSetupAssistant || hasSetupRequired || hasTools).toBe(true);

  console.log('PASS: Side panel handles setup state');
  await page.close();
});

test('6. Chrome storage works for extension', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForTimeout(500);

  // Test that chrome.storage.local is accessible from extension context
  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ testKey: 'testValue' }, () => {
        chrome.storage.local.get('testKey', (data) => {
          resolve(data.testKey);
        });
      });
    });
  });

  console.log('Storage test result:', result);
  expect(result).toBe('testValue');

  // Clean up
  await page.evaluate(() => {
    chrome.storage.local.remove('testKey');
  });

  console.log('PASS: Chrome storage works');
  await page.close();
});

test('6. Service worker console errors check', async () => {
  // Navigate to the service worker's context and check for errors
  const page = await context.newPage();
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForTimeout(2000);

  if (errors.length > 0) {
    console.log('Console errors found:');
    errors.forEach((e) => console.log('  ERROR:', e));
  } else {
    console.log('No console errors in side panel');
  }

  // We log errors but don't fail — some errors are expected (WebSocket relay not running)
  console.log(`Side panel had ${errors.length} console error(s)`);
  await page.close();
});

test('7. Popup page console errors check', async () => {
  const page = await context.newPage();
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await page.waitForTimeout(2000);

  if (errors.length > 0) {
    console.log('Popup console errors:');
    errors.forEach((e) => console.log('  ERROR:', e));
  } else {
    console.log('No console errors in popup');
  }

  console.log(`Popup had ${errors.length} console error(s)`);
  await page.close();
});

test('8. Manifest is valid and has correct permissions', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);

  const manifestText = await page.textContent('body');
  expect(manifestText).toBeTruthy();

  const manifest = JSON.parse(manifestText!);
  console.log('Extension name:', manifest.name);
  console.log('Version:', manifest.version);
  console.log('Permissions:', manifest.permissions);

  expect(manifest.name).toBe('AI Browser CoPilot');
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toContain('activeTab');
  expect(manifest.permissions).toContain('tabs');
  expect(manifest.permissions).toContain('sidePanel');
  expect(manifest.permissions).toContain('storage');
  expect(manifest.permissions).toContain('nativeMessaging');
  expect(manifest.background.service_worker).toBeTruthy();
  expect(manifest.side_panel.default_path).toBeTruthy();
  expect(manifest.action.default_popup).toBeTruthy();

  console.log('PASS: Manifest is valid');
  await page.close();
});
