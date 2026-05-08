/**
 * Drives the extension's real form-handling tools (`read_form`, `fill_form`,
 * `click_element`) end-to-end inside the user's REAL Edge.
 *
 * The extension exposes a `dispatch_tool` runtime message (see
 * background.ts:109) used both by the in-extension chat agent and by tests.
 * We invoke it from a chrome-extension:// page so the chrome.runtime API is
 * available; the dispatcher path is identical to what the MCP server uses.
 *
 * Prereq: launch Edge first with `npm run edge:debug`.
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attachToRealEdge, openSidePanel, dispatchTool } from './helpers/connect-real-edge';

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/form-simple.html');

interface ToolContent {
  content?: Array<{ type: string; text: string }>;
}

const startFixtureServer = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(html);
      return;
    }
    res.writeHead(404).end('not found');
  });
  // Don't keep idle keep-alive sockets open — closing the server otherwise
  // blocks until each peer drains, which can deadlock test cleanup.
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        // Force-close any sockets the browser left half-open.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => resolve());
        // Hard-kill backstop — never let cleanup outlive the test.
        setTimeout(() => resolve(), 1500).unref();
      }),
  };
};

test.describe.configure({ mode: 'serial' });

test('real Edge: read_form / fill_form / click_element exercise the real DOM', async () => {
  const fixture = await startFixtureServer();
  const edge = await attachToRealEdge();
  let sidePanel: import('@playwright/test').Page | undefined;
  let target: import('@playwright/test').Page | undefined;

  try {
    // 1. Open the fixture in the user's real Edge.
    target = await edge.context.newPage();
    await target.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    await expect(target.locator('#contact-form')).toBeVisible();

    // 2. Open side panel — has chrome.* APIs and is the natural driver page.
    sidePanel = await openSidePanel(edge.context, edge.extensionId);

    // 3. Find the fixture's tab id from the extension's perspective.
    const tabId = await sidePanel.evaluate(async (urlPrefix) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url?.startsWith(urlPrefix));
      return tab?.id ?? 0;
    }, fixture.url);
    expect(tabId, 'fixture tab discoverable via chrome.tabs').toBeGreaterThan(0);

    // 4. Make sure the extension has host permission for the fixture origin.
    // If <all_urls> isn't granted, dispatch_tool calls will fail with a
    // confusing CONTENT_UNAVAILABLE; report a clear message instead.
    const hasAllUrls = await sidePanel.evaluate(() =>
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
    );
    test.skip(
      !hasAllUrls,
      'Extension does not have <all_urls> in this profile. Open the side panel and ' +
        'click "Grant access" first, then re-run.',
    );

    // ---- read_form ----
    const readResult = (await dispatchTool(sidePanel, 'read_form', {
      tab_id: tabId,
    })) as ToolContent;
    expect(readResult.content?.[0]?.text, 'read_form returns JSON text').toBeTruthy();
    const readJson = JSON.parse(readResult.content![0].text);
    expect(Array.isArray(readJson.forms), 'read_form returns a forms array').toBe(true);
    expect(readJson.forms.length, 'fixture has at least one form').toBeGreaterThan(0);

    // ---- fill_form ----
    const fillResult = (await dispatchTool(sidePanel, 'fill_form', {
      tab_id: tabId,
      fields: [
        { selector: '#full-name', value: 'Edge Real-Profile Tester' },
        { selector: '#email', value: 'real-edge@example.test' },
        { selector: '#bio', value: 'Filled by Playwright via real Edge over CDP.' },
        { selector: '#country', value: 'us' },
      ],
    })) as ToolContent;
    expect(fillResult.content?.[0]?.text, 'fill_form returned content').toBeTruthy();

    // Assert the real DOM in the real Edge tab actually changed.
    await expect(target.locator('#full-name')).toHaveValue('Edge Real-Profile Tester');
    await expect(target.locator('#email')).toHaveValue('real-edge@example.test');
    await expect(target.locator('#bio')).toHaveValue('Filled by Playwright via real Edge over CDP.');
    await expect(target.locator('#country')).toHaveValue('us');

    // ---- click_element ----
    // Click the Reset button via the tool path; assert DOM clears.
    await dispatchTool(sidePanel, 'click_element', {
      tab_id: tabId,
      selector: '#contact-form button[type="reset"]',
    });
    await expect(target.locator('#full-name')).toHaveValue('');
    await expect(target.locator('#email')).toHaveValue('');
  } finally {
    // Order matters: close the fixture server FIRST so its setTimeout backstop
    // can't outlive the test. Then close pages and the CDP browser handle.
    await fixture.close();
    await sidePanel?.close().catch(() => {});
    await target?.close().catch(() => {});
    await edge.browser.close().catch(() => {});
  }
});
