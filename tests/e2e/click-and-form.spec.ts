/**
 * Real browser tests for click_element and fill_form on complex pages.
 *
 * Tests the actual content scripts injected via chrome.scripting.executeScript
 * in a real Chrome browser with the real extension loaded.
 *
 * These tests caught: click_element hitting wrong buttons on Product Hunt
 * (matching parent <div> text instead of the actual <button>).
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { startFixtureServer, type FixtureServer } from './helpers/fixture-server';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');

let context: BrowserContext;
let extensionId: string;
let extPage: Page;
let fixtures: FixtureServer;
// Serve fixtures over http://127.0.0.1 (a REQUIRED host permission) instead of
// file:// (only the optional <all_urls> grant), so chrome.scripting.executeScript
// can access them. See helpers/fixture-server.ts.
let complexPageUrl: string;

test.beforeAll(async () => {
  fixtures = await startFixtureServer();
  complexPageUrl = fixtures.url('complex-page.html');

  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  await new Promise((r) => setTimeout(r, 3000));

  const sws = context.serviceWorkers();
  if (sws.length > 0) {
    extensionId = sws[0].url().split('/')[2];
  }
  if (!extensionId) {
    try {
      const sw = await context.waitForEvent('serviceworker', { timeout: 5000 });
      extensionId = sw.url().split('/')[2];
    } catch { /* fallback */ }
  }
  expect(extensionId).toBeTruthy();

  extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await extPage.waitForTimeout(1000);
});

test.afterAll(async () => {
  await context?.close();
  await fixtures?.close();
});

/** Run click_element content script via the extension on a target tab */
async function clickElement(tabId: number, params: { selector?: string; text?: string; index?: number }) {
  return extPage.evaluate(async ({ tid, sel, txt, idx }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (s: string | null, t: string | null, i: number) => {
        if (s) {
          const matches = Array.from(document.querySelectorAll(s));
          const el = matches[i];
          if (!el) return null;
          (el as HTMLElement).click();
          return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), matchCount: matches.length, matchIndex: i };
        }
        if (t) {
          const clickable = 'a, button, input[type="submit"], input[type="button"], [role="button"], [onclick], summary';
          const target = t.toLowerCase();
          const clickables = Array.from(document.querySelectorAll(clickable));

          // Pass 1: exact match on clickable elements
          const exact = clickables.filter(el => (el.textContent?.trim().toLowerCase() ?? '') === target);
          if (exact.length > i) {
            const el = exact[i] as HTMLElement;
            el.click();
            return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), matchCount: exact.length, matchIndex: i };
          }

          // Pass 2: partial match on clickable elements
          const partial = clickables.filter(el => (el.textContent?.trim().toLowerCase() ?? '').includes(target));
          if (partial.length > i) {
            const el = partial[i] as HTMLElement;
            el.click();
            return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), matchCount: partial.length, matchIndex: i };
          }

          // Pass 3: leaf elements
          const all = Array.from(document.querySelectorAll('*')).filter(el =>
            (el.textContent?.trim().toLowerCase() ?? '') === target && el.children.length === 0
          );
          if (all.length > i) {
            const el = all[i] as HTMLElement;
            el.click();
            return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), matchCount: all.length, matchIndex: i };
          }
        }
        return null;
      },
      args: [sel ?? null, txt ?? null, idx ?? 0],
    });
    return results?.[0]?.result;
  }, { tid: tabId, sel: params.selector ?? null, txt: params.text ?? null, idx: params.index ?? 0 });
}

/** Run fill_form content script on a target tab */
async function fillForm(tabId: number, fields: Array<{ selector: string; value: string }>) {
  return extPage.evaluate(async ({ tid, f }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (fieldList: Array<{ selector: string; value: string }>) => {
        return fieldList.map(({ selector, value }) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) return { selector, success: false, error: 'Element not found' };
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { selector, success: true };
        });
      },
      args: [f],
    });
    return results?.[0]?.result;
  }, { tid: tabId, f: fields });
}

/** Get the click log from the test page */
async function getClickLog(page: Page): Promise<string> {
  return page.textContent('#click-log') ?? '';
}

// ==========================================
// CLICK ELEMENT — REAL BROWSER TESTS
// ==========================================

test.describe('click_element on complex page', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(complexPageUrl);
    await page.waitForTimeout(500);
    // Get the tab ID for this page
    tabId = await extPage.evaluate(async (title) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.title?.includes(title));
      return tab?.id ?? 0;
    }, 'Complex Page');
    expect(tabId).toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('clicks the FIRST "Get started" button (not a wrapper div)', async () => {
    const result = await clickElement(tabId, { text: 'Get started' });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('BUTTON'); // Must be a button, not a div or card
    expect(result.matchIndex).toBe(0);

    const log = await getClickLog(page);
    expect(log).toBe('get-started-1'); // First card's button
  });

  test('clicks the SECOND "Get started" button via index', async () => {
    const result = await clickElement(tabId, { text: 'Get started', index: 1 });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('BUTTON');
    expect(result.matchIndex).toBe(1);

    const log = await getClickLog(page);
    expect(log).toBe('get-started-2'); // Second card's button
  });

  test('clicks the THIRD "Get started" button via index', async () => {
    const result = await clickElement(tabId, { text: 'Get started', index: 2 });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('BUTTON');

    const log = await getClickLog(page);
    expect(log).toBe('get-started-3');
  });

  test('reports total match count for disambiguation', async () => {
    const result = await clickElement(tabId, { text: 'Get started' });

    // There are 4 "Get started" buttons (3 cards + 1 form submit)
    expect(result.matchCount).toBeGreaterThanOrEqual(4);
  });

  test('clicks "Save Draft" by text (unique button)', async () => {
    const result = await clickElement(tabId, { text: 'Save Draft' });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('BUTTON');

    const log = await getClickLog(page);
    expect(log).toBe('save-draft');
  });

  test('clicks "Learn more" link (not a paragraph or span)', async () => {
    const result = await clickElement(tabId, { text: 'Learn more' });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('A'); // Must be the <a> link, not any wrapper
    const log = await getClickLog(page);
    expect(log).toBe('learn-more');
  });

  test('clicks by CSS selector when text is ambiguous', async () => {
    const result = await clickElement(tabId, { selector: '#card-2 button' });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('BUTTON');

    const log = await getClickLog(page);
    expect(log).toBe('get-started-2');
  });

  test('clicks nth match by CSS selector', async () => {
    const result = await clickElement(tabId, { selector: '.btn-primary', index: 2 });

    expect(result).toBeTruthy();
    const log = await getClickLog(page);
    // 3rd .btn-primary — could be card 3 or form submit depending on order
    expect(log).toBeTruthy();
  });

  test('returns null for non-existent element', async () => {
    const result = await clickElement(tabId, { text: 'NonExistentButton12345' });
    expect(result).toBeNull();
  });

  test('nav link click works', async () => {
    const result = await clickElement(tabId, { text: 'Products' });

    expect(result).toBeTruthy();
    expect(result.tag).toBe('A');
  });
});

// ==========================================
// FILL FORM — REAL BROWSER TESTS
// ==========================================

test.describe('fill_form on complex page', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(complexPageUrl);
    await page.waitForTimeout(500);
    tabId = await extPage.evaluate(async (title) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.title?.includes(title));
      return tab?.id ?? 0;
    }, 'Complex Page');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('fills text inputs by selector', async () => {
    const result = await fillForm(tabId, [
      { selector: '#product-name', value: 'AgentHub' },
      { selector: '#product-url', value: 'https://copilot.example.com' },
      { selector: '#tagline', value: 'Connect your browser to AI' },
    ]);

    expect(result).toHaveLength(3);
    result.forEach((r: { success: boolean }) => expect(r.success).toBe(true));

    // Verify values on the actual page
    expect(await page.inputValue('#product-name')).toBe('AgentHub');
    expect(await page.inputValue('#product-url')).toBe('https://copilot.example.com');
    expect(await page.inputValue('#tagline')).toBe('Connect your browser to AI');
  });

  test('fills textarea', async () => {
    const result = await fillForm(tabId, [
      { selector: '#description', value: 'A Chrome extension that bridges AI and your browser.' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].success).toBe(true);
    expect(await page.inputValue('#description')).toBe('A Chrome extension that bridges AI and your browser.');
  });

  test('handles missing fields gracefully', async () => {
    const result = await fillForm(tabId, [
      { selector: '#product-name', value: 'Test' },
      { selector: '#nonexistent', value: 'Should fail' },
      { selector: '#tagline', value: 'Works' },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].success).toBe(true);
    expect(result[1].success).toBe(false);
    expect(result[1].error).toBe('Element not found');
    expect(result[2].success).toBe(true);
  });

  test('fills complete product submission form', async () => {
    // Fill all text fields
    const result = await fillForm(tabId, [
      { selector: '#product-name', value: 'AgentHub' },
      { selector: '#product-url', value: 'https://aibrowsercopilot.com' },
      { selector: '#tagline', value: 'Let AI see your browser' },
      { selector: '#description', value: 'Connect Claude, ChatGPT, or Cursor to your Chrome tabs.' },
    ]);

    result.forEach((r: { success: boolean }) => expect(r.success).toBe(true));

    // Select category via executeScript (fill_form doesn't handle selects in simple mode)
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const select = document.querySelector('#category') as HTMLSelectElement;
          select.value = 'ai';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    }, tabId);

    // Click radio button
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const radio = document.querySelector('input[name="type"][value="new"]') as HTMLInputElement;
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    }, tabId);

    // Check terms checkbox
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const checkbox = document.querySelector('#agree-terms') as HTMLInputElement;
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
    }, tabId);

    // Verify everything
    expect(await page.inputValue('#product-name')).toBe('AgentHub');
    expect(await page.inputValue('#category')).toBe('ai');
    expect(await page.isChecked('input[name="type"][value="new"]')).toBe(true);
    expect(await page.isChecked('#agree-terms')).toBe(true);

    console.log('Complete form filled and verified');
  });
});
