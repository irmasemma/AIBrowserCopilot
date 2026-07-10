// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

// ---------------------------------------------------------------------------
// Minimal chrome mock, same shape as entrypoints/sidepanel/main.test.tsx.
// ---------------------------------------------------------------------------
let store: Record<string, unknown> = {};

function installChromeMock() {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn(() => Promise.resolve({ ok: true, result: 'done' })),
    },
    storage: {
      local: {
        get: vi.fn((keys: unknown, cb?: (d: Record<string, unknown>) => void) => {
          const pick = (k: string) => (k in store ? { [k]: store[k] } : {});
          let result: Record<string, unknown> = {};
          if (typeof keys === 'string') result = pick(keys);
          else if (Array.isArray(keys)) result = keys.reduce((a, k) => ({ ...a, ...pick(k) }), {});
          else result = { ...store };
          if (cb) { cb(result); return undefined; }
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(store, items);
          if (cb) { cb(); return undefined; }
          return Promise.resolve();
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
    },
  });
}

// Mock only `runChat` — keep everything else (isContextLengthError,
// buildInitialMessages, SYSTEM_PROMPT, etc.) real so chat-tab.tsx's own error
// classification is what's under test.
const { mockRunChat } = vi.hoisted(() => ({ mockRunChat: vi.fn() }));
vi.mock('../chat-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chat-engine.js')>();
  return { ...actual, runChat: mockRunChat };
});

import { ChatTab } from './chat-tab.js';

let container: HTMLDivElement;

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  store = { openaiApiKey: 'sk-test-key' };
  installChromeMock();
  mockRunChat.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { render(null, container); });
  container.remove();
  vi.unstubAllGlobals();
});

async function sendMessage(text: string) {
  await act(async () => { render(<ChatTab onOpenSettings={() => {}} />, container); });
  await flush();

  const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="chat-textarea"]')!;
  await act(async () => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();

  const sendBtn = container.querySelector<HTMLButtonElement>('[data-testid="chat-send-button"]')!;
  await act(async () => { sendBtn.click(); });
  await flush();
  await flush();
}

describe('ChatTab error rendering', () => {
  it('shows the friendly "conversation too large" message for a context-length error that survives the retry', async () => {
    mockRunChat.mockRejectedValue(
      Object.assign(new Error('prompt is too long: 403154 tokens > 200000'), {
        status: 400,
        errorType: 'invalid_request_error',
      }),
    );

    await sendMessage('do something huge');

    const errorEntry = container.querySelector('[data-entry-kind="error"]');
    expect(errorEntry).not.toBeNull();
    expect(errorEntry!.textContent).toContain('too large');
    expect(errorEntry!.textContent).toContain('Start a new conversation');
    expect(errorEntry!.textContent).not.toContain('403154');
  });

  it('shows the raw error message unchanged for a non-context-length error (inverse case)', async () => {
    mockRunChat.mockRejectedValue(
      Object.assign(new Error('Anthropic request failed (500)'), {
        status: 500,
        errorType: 'api_error',
      }),
    );

    await sendMessage('do something');

    const errorEntry = container.querySelector('[data-entry-kind="error"]');
    expect(errorEntry).not.toBeNull();
    expect(errorEntry!.textContent).toContain('Anthropic request failed (500)');
    expect(errorEntry!.textContent).not.toContain('too large');
  });
});
