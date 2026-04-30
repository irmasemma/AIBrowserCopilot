import type { FunctionalComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import { getDisplayState } from '../../shared/types.js';

const SUPPORT_URL = 'https://github.com/irmasemma/AIBrowserCopilot/issues';
const FAQ_URL = 'https://github.com/irmasemma/AIBrowserCopilot/wiki/FAQ';

export const SettingsTab: FunctionalComponent = () => {
  const connectionContext = useStore((s) => s.connectionContext);
  const displayState = getDisplayState(connectionContext);

  const [apiKey, setApiKey] = useState('');
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get('openaiApiKey', (data) => {
      const key = typeof data.openaiApiKey === 'string' ? data.openaiApiKey : '';
      setApiKey(key);
      setDraft(key);
      setLoaded(true);
    });
  }, []);

  const save = async () => {
    const trimmed = draft.trim();
    await chrome.storage.local.set({ openaiApiKey: trimmed });
    setApiKey(trimmed);
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2000);
  };

  const clear = async () => {
    await chrome.storage.local.set({ openaiApiKey: '' });
    setApiKey('');
    setDraft('');
  };

  const masked = apiKey ? `sk-…${apiKey.slice(-4)}` : 'not set';

  return (
    <div class="px-4 py-4 space-y-6 text-sm">
      <section>
        <h3 class="font-semibold text-neutral-800 mb-1">OpenAI API Key</h3>
        <p class="text-xs text-neutral-500 mb-2">
          Used by the Chat tab. Stored locally on this device only — never sent to our servers.
          Get a key at{' '}
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener"
            class="text-brand-primary hover:underline"
          >
            platform.openai.com/api-keys
          </a>
          .
        </p>

        <div class="text-xs text-neutral-500 mb-2">
          Currently: <span class="font-mono text-neutral-700">{loaded ? masked : '…'}</span>
        </div>

        <div class="flex gap-2 mb-2">
          <input
            type={reveal ? 'text' : 'password'}
            class="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-primary"
            placeholder="sk-…"
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck={false}
          />
          <button
            class="text-xs text-neutral-600 px-2 hover:text-neutral-900"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        <div class="flex gap-2 items-center">
          <button
            class="text-sm font-medium text-white bg-brand-primary px-3 py-1.5 rounded hover:bg-brand-primary-dark disabled:opacity-50"
            onClick={() => void save()}
            disabled={draft.trim() === apiKey}
          >
            Save
          </button>
          {apiKey && (
            <button
              class="text-sm text-red-600 px-3 py-1.5 rounded hover:bg-red-50"
              onClick={() => void clear()}
            >
              Clear
            </button>
          )}
          {savedAt && <span class="text-xs text-green-600">Saved</span>}
        </div>
      </section>

      <section class="border-t border-neutral-200 pt-4">
        <h3 class="font-semibold text-neutral-800 mb-1">MCP Connection</h3>
        <p class="text-xs text-neutral-500 mb-2">
          Lets external AI tools (Claude Code, Cursor, etc.) drive your browser through this
          extension. Independent from the Chat tab — you can use either or both.
        </p>
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs text-neutral-500">Status:</span>
          <span class="text-xs font-medium text-neutral-800">{displayState}</span>
          <button
            class="ml-auto text-xs text-brand-primary hover:underline"
            onClick={() => chrome.runtime.sendMessage({ type: 'verify_connection' })}
          >
            Check now
          </button>
        </div>
        {connectionContext.serverInfo?.startedBy && connectionContext.serverInfo.startedBy !== 'unknown' && (
          <p class="text-xs text-neutral-500">
            Connected via <span class="font-medium">{connectionContext.serverInfo.startedBy}</span>
          </p>
        )}
      </section>

      <section class="border-t border-neutral-200 pt-4">
        <h3 class="font-semibold text-neutral-800 mb-1">Help</h3>
        <div class="space-x-3 text-xs">
          <a href={SUPPORT_URL} target="_blank" rel="noopener" class="text-brand-primary hover:underline">
            Report a problem
          </a>
          <a href={FAQ_URL} target="_blank" rel="noopener" class="text-brand-primary hover:underline">
            Is this safe?
          </a>
        </div>
      </section>
    </div>
  );
};
