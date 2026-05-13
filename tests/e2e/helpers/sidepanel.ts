/**
 * Drive the side-panel UI: locate the badge / header, wait for "Connected",
 * seed an API key into chrome.storage so the chat tab is usable, and run
 * a chat turn that should trigger list_tabs.
 *
 * The chat tab requires an LLM API key. For tests we read it from env:
 *   COPILOT_TEST_LLM_PROVIDER (openai|anthropic|gemini, default openai)
 *   COPILOT_TEST_LLM_KEY      (required to run the chat assertions)
 *   COPILOT_TEST_LLM_MODEL    (per-provider default below)
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { setTimeout as wait } from 'node:timers/promises';

export type Provider = 'openai' | 'anthropic' | 'gemini';

export interface ChatConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
};

const STORAGE_KEY: Record<Provider, string> = {
  openai: 'openaiApiKey',
  anthropic: 'anthropicApiKey',
  gemini: 'geminiApiKey',
};

export const readChatConfigFromEnv = (): ChatConfig | null => {
  const apiKey = process.env.COPILOT_TEST_LLM_KEY;
  if (!apiKey) return null;
  const provider = (process.env.COPILOT_TEST_LLM_PROVIDER ?? 'openai') as Provider;
  if (!['openai', 'anthropic', 'gemini'].includes(provider)) {
    throw new Error(`Bad COPILOT_TEST_LLM_PROVIDER="${provider}" — must be openai|anthropic|gemini`);
  }
  const model = process.env.COPILOT_TEST_LLM_MODEL ?? DEFAULT_MODEL[provider];
  return { provider, apiKey, model };
};

/**
 * If no env config is provided, look for an API key already saved in
 * chrome.storage.local for this profile + extension ID. We pick the first
 * provider that has a non-empty key.
 */
export const readChatConfigFromStorage = async (page: Page): Promise<ChatConfig | null> => {
  const data = await page.evaluate(() =>
    chrome.storage.local.get(['openaiApiKey', 'anthropicApiKey', 'geminiApiKey']),
  );
  for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
    const key = (data as Record<string, string | undefined>)[STORAGE_KEY[provider]];
    if (typeof key === 'string' && key.trim().length > 0) {
      return { provider, apiKey: key, model: DEFAULT_MODEL[provider] };
    }
  }
  return null;
};

export const openSidePanel = async (context: BrowserContext, extensionId: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: 'domcontentloaded',
  });
  // Preact mount + initial state hydration.
  await page.waitForSelector('[data-testid="connection-header"]', { timeout: 10_000 });
  return page;
};

export const seedChatConfig = async (page: Page, config: ChatConfig): Promise<void> => {
  await page.evaluate(
    ({ key, value, provider, model }) =>
      chrome.storage.local.set({
        [key]: value,
        chatProvider: provider,
        chatModel: model,
      }),
    {
      key: STORAGE_KEY[config.provider],
      value: config.apiKey,
      provider: config.provider,
      model: config.model,
    },
  );
};

export interface ConnectionDisplay {
  badgeLabel: string;
  badgeState: string;
  title: string;
  subtitle: string;
}

const readDisplayOnce = async (page: Page): Promise<ConnectionDisplay> => {
  const badge = page.locator('[data-testid="status-badge"]').first();
  const title = page.locator('[data-testid="connection-header-title"]').first();
  const subtitle = page.locator('[data-testid="connection-header-subtitle"]').first();
  return {
    badgeLabel: (await badge.getAttribute('data-label')) ?? '',
    badgeState: (await badge.getAttribute('data-state')) ?? '',
    title: (await title.textContent())?.trim() ?? '',
    subtitle: (await subtitle.count()) > 0 ? ((await subtitle.textContent())?.trim() ?? '') : '',
  };
};

export const waitForConnected = async (
  page: Page,
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<ConnectionDisplay> => {
  const deadline = Date.now() + timeoutMs;
  let last: ConnectionDisplay = { badgeLabel: '', badgeState: '', title: '', subtitle: '' };
  while (Date.now() < deadline) {
    last = await readDisplayOnce(page);
    if (last.badgeLabel === 'Connected' && last.title === 'Connected') {
      return last;
    }
    await wait(500);
  }
  throw new Error(
    `Side panel did not reach Connected within ${timeoutMs}ms.\n` +
      `Last seen: badge="${last.badgeLabel}" (state=${last.badgeState}) ` +
      `title="${last.title}" subtitle="${last.subtitle}"`,
  );
};

export const assertConnected = (display: ConnectionDisplay): void => {
  expect(display.badgeLabel, 'status badge label').toBe('Connected');
  expect(display.title, 'connection-header title').toBe('Connected');
  expect(display.subtitle, 'connection-header subtitle').toMatch(/^Bridge running/);
};

export const switchToChatTab = async (page: Page): Promise<void> => {
  // Chat is the default tab on first open. If a previous turn left us on
  // another tab, click back via the role=tab strip.
  const chatTab = page.getByRole('tab', { name: 'Chat' });
  const count = await chatTab.count();
  if (count > 0) {
    await chatTab.first().click();
    await page.waitForSelector('[data-testid="chat-textarea"]', { timeout: 10_000 });
  }
};

export const startNewChat = async (page: Page): Promise<void> => {
  const newButton = page.locator('[data-testid="chat-new-button"]');
  if ((await newButton.count()) > 0) {
    await newButton.first().click();
    // The button only renders when a transcript exists; after click the
    // transcript clears and the button disappears.
    await wait(150);
  }
};

export interface ToolInvocation {
  toolName: string;
  ok: boolean;
  text: string;
}

export const sendChatMessage = async (page: Page, message: string): Promise<void> => {
  const textarea = page.locator('[data-testid="chat-textarea"]');
  await textarea.fill(message);
  await page.locator('[data-testid="chat-send-button"]').click();
};

export const waitForToolCall = async (
  page: Page,
  toolName: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<ToolInvocation> => {
  const locator = page.locator(`[data-testid="chat-tool-call"][data-tool-name="${toolName}"]`).first();
  await locator.waitFor({ state: 'visible', timeout: timeoutMs });
  const ok = (await locator.getAttribute('data-tool-ok')) === 'true';
  const text = (await locator.textContent())?.trim() ?? '';
  return { toolName, ok, text };
};

export interface ListTabsTab {
  id: string | null;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
}

export const dispatchListTabs = async (page: Page): Promise<ListTabsTab[]> => {
  const result = await page.evaluate(
    () =>
      new Promise<{ ok: boolean; result?: unknown; error?: { message: string; code: string } }>(
        (resolve) => {
          chrome.runtime.sendMessage({ type: 'dispatch_tool', name: 'list_tabs', params: {} }, (resp) => {
            resolve(resp);
          });
        },
      ),
  );
  if (!result.ok) {
    throw new Error(`list_tabs dispatch failed: ${JSON.stringify(result.error)}`);
  }
  const payload = result.result as { content?: Array<{ type: string; text?: string }> };
  if (!payload?.content?.[0]?.text) {
    throw new Error(`list_tabs returned an unexpected shape: ${JSON.stringify(payload)}`);
  }
  return JSON.parse(payload.content[0].text) as ListTabsTab[];
};

export const assertListTabsResult = (tabs: ListTabsTab[]): void => {
  expect(Array.isArray(tabs), 'list_tabs returns an array').toBe(true);
  expect(tabs.length, 'list_tabs returns at least one tab').toBeGreaterThanOrEqual(1);
  const withUrl = tabs.find((t) => typeof t.url === 'string' && t.url.length > 0);
  expect(withUrl, 'at least one tab has a non-empty url').toBeTruthy();
};

export const LIST_TABS_PROMPT =
  'Use the list_tabs tool right now to enumerate every tab open in my browser. Call the tool — do not describe what you would do.';
