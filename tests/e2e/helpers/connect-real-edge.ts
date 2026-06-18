/**
 * Helpers for tests that attach to a real Microsoft Edge running with
 * --remote-debugging-port (started via `npm run edge:debug`).
 *
 * The launcher writes tests/e2e/.edge-debug.json with the port + extension
 * path. This module reads that file, connects via CDP, and locates the
 * AgentHub service worker (matched by manifest name so it works
 * even when other extensions are also installed in the user's profile).
 */
import { chromium, type Browser, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STATE_FILE = path.resolve(REPO_ROOT, 'tests/e2e/.edge-debug.json');

const EXTENSION_NAME = 'AgentHub';

export interface EdgeDebugState {
  port: number;
  webSocketDebuggerUrl?: string;
  browser?: string;
  extensionPath: string;
  userDataDir: string;
  profile: string;
  pid?: number;
  startedAt: string;
}

export const readDebugState = (): EdgeDebugState => {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `${STATE_FILE} not found. Start Edge first with:\n  npm run edge:debug`,
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
};

export interface AttachedEdge {
  browser: Browser;
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  port: number;
}

const fetchManifestName = async (
  context: BrowserContext,
  extensionId: string,
): Promise<string | null> => {
  const page = await context.newPage();
  try {
    const url = `chrome-extension://${extensionId}/manifest.json`;
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 5000 }).catch(() => null);
    if (!resp || !resp.ok()) return null;
    const text = await resp.text();
    const manifest = JSON.parse(text) as { name?: string };
    return manifest.name ?? null;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
};

const findAgentHubExtension = async (
  context: BrowserContext,
  timeoutMs = 15000,
): Promise<{ extensionId: string; serviceWorker: Worker }> => {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];
  while (Date.now() < deadline) {
    const sws = context.serviceWorkers();
    lastSeen = sws.map((sw) => sw.url());
    for (const sw of sws) {
      const m = sw.url().match(/^chrome-extension:\/\/([a-z]+)\//);
      if (!m) continue;
      const extensionId = m[1];
      const name = await fetchManifestName(context, extensionId);
      // Match by prefix: the shipped manifest name carries a marketing suffix
      // ("AgentHub — AI Chat + MCP for …"), so an exact match would miss it.
      if (name && name.startsWith(EXTENSION_NAME)) {
        return { extensionId, serviceWorker: sw };
      }
    }
    await wait(500);
  }
  throw new Error(
    `Could not find "${EXTENSION_NAME}" service worker within ${timeoutMs}ms.\n` +
      `Service workers seen: ${lastSeen.join(', ') || '(none)'}.\n` +
      `If you launched Edge with your real profile, ensure Developer mode is ON in edge://extensions ` +
      `so --load-extension is honored.`,
  );
};

export const attachToRealEdge = async (timeoutMs = 15000): Promise<AttachedEdge> => {
  const state = readDebugState();
  const cdpUrl = `http://127.0.0.1:${state.port}`;
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close().catch(() => {});
    throw new Error('CDP connection returned no contexts — is Edge fully started?');
  }
  const context = contexts[0];
  const { extensionId, serviceWorker } = await findAgentHubExtension(context, timeoutMs);
  return { browser, context, extensionId, serviceWorker, port: state.port };
};

/** Convenience: open the side panel as a regular extension page (full chrome.* APIs). */
export const openSidePanel = async (
  context: BrowserContext,
  extensionId: string,
) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: 'domcontentloaded',
  });
  // Give Preact one tick to render.
  await wait(800);
  return page;
};

/**
 * Dispatch a tool through the extension's existing dispatch_tool message
 * channel (background.ts:109). Must be called from an extension page so
 * chrome.runtime is available.
 */
export const dispatchTool = async (
  page: import('@playwright/test').Page,
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<unknown> => {
  const result = await page.evaluate(
    ({ name, p }) =>
      new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'dispatch_tool', name, params: p },
          (resp: { ok: boolean; result?: unknown; error?: { message: string; code: string } }) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr) {
              reject(new Error(`runtime.lastError: ${lastErr.message}`));
              return;
            }
            if (!resp) {
              reject(new Error('No response from background'));
              return;
            }
            if (!resp.ok) {
              const err = resp.error ?? { message: 'unknown', code: 'CONTENT_UNAVAILABLE' };
              reject(Object.assign(new Error(err.message), { code: err.code }));
              return;
            }
            resolve(resp.result);
          },
        );
      }),
    { name: toolName, p: params },
  );
  return result;
};

export { EXTENSION_NAME };
