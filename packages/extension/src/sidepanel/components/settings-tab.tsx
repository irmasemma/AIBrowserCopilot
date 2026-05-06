import type { FunctionalComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import { getDisplayState } from '../../shared/types.js';

const SUPPORT_URL = 'https://github.com/irmasemma/AIBrowserCopilot/issues';
const FAQ_URL = 'https://github.com/irmasemma/AIBrowserCopilot/wiki/FAQ';

interface McpStatus {
  available: boolean;
  configExists: boolean;
  configPath: string;
  registered: boolean;
  scope: 'user' | 'project' | null;
  binaryPath: string;
  binaryExists: boolean;
}

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
        <ClaudeCodeRegistrationCard />
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

// Self-heal card for Claude Code MCP registration. Detects when CoPilot has been
// dropped from `~/.claude.json` (which happens when `claude mcp` commands run, manual
// edits, or auto-pruning silently rewrite the file) and offers a one-click re-register.
const ClaudeCodeRegistrationCard: FunctionalComponent = () => {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const refresh = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'check_mcp_registration' });
      if (res && typeof res === 'object') setStatus(res as McpStatus);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const onRepair = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'repair_mcp_registration' });
      if (res?.success) {
        setMessage({
          kind: 'success',
          text: 'Re-added to ~/.claude.json. Restart your AI tool to pick it up.',
        });
        await refresh();
      } else {
        setMessage({
          kind: 'error',
          text: res?.error ?? 'Repair failed for an unknown reason.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Don't render anything until we know the status — keeps the UI quiet when
  // the helper isn't installed.
  if (!status || !status.available) return null;

  // Happy path: registered at user scope, nothing to do. Show a quiet confirmation.
  if (status.registered && status.scope === 'user') {
    return (
      <div class="mt-3 text-xs text-neutral-500">
        ✓ Registered with Claude Code (user scope)
      </div>
    );
  }

  // Project scope works but is fragile — encourage moving it to user scope.
  if (status.registered && status.scope === 'project') {
    return (
      <div class="mt-3 p-2 rounded border border-amber-200 bg-amber-50">
        <p class="text-xs font-medium text-amber-900">
          CoPilot is registered with Claude Code, but at <em>project scope</em>.
        </p>
        <p class="text-xs text-amber-800 mt-1 mb-2">
          Project-scope entries are easy to lose — `claude mcp` commands and config
          rewrites can drop them silently. Move to user scope so it survives.
        </p>
        <button
          class="text-xs font-medium text-white bg-amber-500 px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50"
          onClick={() => void onRepair()}
          disabled={busy}
        >
          {busy ? 'Adding…' : 'Move to user scope'}
        </button>
        {message && (
          <p class={`text-xs mt-2 ${message.kind === 'success' ? 'text-green-700' : 'text-red-700'}`}>
            {message.text}
          </p>
        )}
      </div>
    );
  }

  // Not registered, but Claude Code's config exists → offer one-click re-add.
  if (status.configExists) {
    return (
      <div class="mt-3 p-2 rounded border-l-4 border-amber-300 bg-amber-50">
        <p class="text-xs font-medium text-amber-900">
          CoPilot is not currently registered with Claude Code.
        </p>
        <p class="text-xs text-amber-800 mt-1 mb-2">
          This can happen when `claude mcp` commands rewrite ~/.claude.json and drop
          our entry. Re-add at user scope so it survives future rewrites.
        </p>
        <button
          class="text-xs font-medium text-white bg-amber-500 px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50"
          onClick={() => void onRepair()}
          disabled={busy || !status.binaryExists}
          title={!status.binaryExists ? 'Native host binary not found — run installer first' : ''}
        >
          {busy ? 'Adding…' : 'Re-add to Claude Code'}
        </button>
        {!status.binaryExists && (
          <p class="text-xs text-red-700 mt-2">
            Native host binary not found at {status.binaryPath}. Run the installer first.
          </p>
        )}
        {message && (
          <p class={`text-xs mt-2 ${message.kind === 'success' ? 'text-green-700' : 'text-red-700'}`}>
            {message.text}
          </p>
        )}
      </div>
    );
  }

  // Config doesn't exist at all → user hasn't run Claude Code yet. Stay quiet —
  // showing "Claude Code not detected" everywhere would be noise.
  return null;
};
