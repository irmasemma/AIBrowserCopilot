/**
 * Verifies the extension's MCP / native-host connection in the user's
 * REAL Microsoft Edge (not the bundled Chromium, not a temp profile).
 *
 * Prereq: launch Edge first with `npm run edge:debug`.
 */
import { test, expect } from '@playwright/test';
import { attachToRealEdge, openSidePanel } from './helpers/connect-real-edge';

interface ConnCtx {
  state?: 'connected' | 'reconnecting' | 'disconnected' | 'idle';
  serverInfo?: {
    pid?: number;
    port?: number;
    startedBy?: string;
    version?: string;
  };
  lastError?: { code?: string; message?: string };
}

test.describe.configure({ mode: 'serial' });

test('real Edge: extension connects to native host and reports server_info', async () => {
  const edge = await attachToRealEdge();
  const page = await openSidePanel(edge.context, edge.extensionId);
  try {
    // Poll for connection. The extension does discovery → WS → server_info on
    // service-worker spin-up, which the side panel triggers.
    const start = Date.now();
    let ctx: ConnCtx | undefined;
    while (Date.now() - start < 15000) {
      ctx = (await page.evaluate(async () => {
        const data = await chrome.storage.local.get('connectionContext');
        return data.connectionContext ?? null;
      })) as ConnCtx | null ?? undefined;
      if (ctx?.state === 'connected') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(ctx, 'connectionContext should be populated by the extension').toBeTruthy();
    expect(ctx?.state, `expected connected, got ${ctx?.state} (lastError: ${JSON.stringify(ctx?.lastError)})`)
      .toBe('connected');
    expect(ctx?.serverInfo, 'serverInfo present').toBeTruthy();
    expect(ctx?.serverInfo?.port, 'serverInfo.port is a number').toEqual(expect.any(Number));
    expect(ctx?.serverInfo?.startedBy, 'serverInfo.startedBy non-empty').toBeTruthy();
    console.log(
      `connected to ${ctx?.serverInfo?.startedBy} on port ${ctx?.serverInfo?.port} ` +
        `(host pid ${ctx?.serverInfo?.pid}, v${ctx?.serverInfo?.version})`,
    );
  } finally {
    await page.close().catch(() => {});
    await edge.browser.close().catch(() => {});
  }
});

test('real Edge: side panel UI shows "Connected"', async () => {
  const edge = await attachToRealEdge();
  const page = await openSidePanel(edge.context, edge.extensionId);
  try {
    // Wait for the side panel to render the connected indicator. The exact
    // copy varies by client (Connected via Claude Code / GitHub Copilot CLI /
    // etc.), so we assert the word "Connected" is present anywhere in the UI.
    await expect(page.locator('body')).toContainText(/Connected/i, { timeout: 15000 });
    const text = (await page.textContent('body')) ?? '';
    console.log(
      'side panel text excerpt:',
      text.replace(/\s+/g, ' ').slice(0, 200),
    );
  } finally {
    await page.close().catch(() => {});
    await edge.browser.close().catch(() => {});
  }
});
