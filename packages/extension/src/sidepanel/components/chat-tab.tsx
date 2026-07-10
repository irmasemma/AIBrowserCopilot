import type { FunctionalComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import {
  buildInitialMessages,
  isContextLengthError,
  runChat,
  type CanonicalMessage,
  type ToolCallEvent,
} from '../chat-engine.js';
import {
  CUSTOM_OPTION_VALUE,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER,
  MODELS_BY_PROVIDER,
  PROVIDER_META,
  type ModelOption,
} from '../models.js';
import type { ProviderId } from '../providers/types.js';
import { getBrowserInstanceId } from '../../shared/browser-instance-id.js';
import { composeTabId } from '../../shared/tab-id.js';

interface ChatTabProps {
  onOpenSettings: () => void;
  // Active = this tab's panel is currently visible. We need this because the
  // panel is always mounted (so chat history survives tab switches) and
  // display:none zeroes out scrollHeight — auto-scroll on new entries while
  // hidden is a no-op, so we re-anchor to the bottom when the tab returns.
  isActive?: boolean;
}

interface DisplayEntry {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  toolName?: string;
  ok?: boolean;
}

const PROVIDER_ORDER: ProviderId[] = ['openai', 'anthropic', 'gemini'];

const ProviderIcon: FunctionalComponent<{ provider: ProviderId; className?: string }> = ({
  provider,
  className,
}) => {
  // Tiny inline SVG marks — neutral monochrome so they fit any theme.
  if (provider === 'openai') {
    return (
      <svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
        <path d="M22.28 9.81a5.96 5.96 0 0 0-.51-4.91 6.04 6.04 0 0 0-6.5-2.9A6 6 0 0 0 4.99 4.06a5.96 5.96 0 0 0-3.99 2.9 6.04 6.04 0 0 0 .74 7.07 5.96 5.96 0 0 0 .51 4.91 6.04 6.04 0 0 0 6.5 2.9 5.99 5.99 0 0 0 4.52 2.06 6.04 6.04 0 0 0 5.76-4.18 5.96 5.96 0 0 0 3.98-2.9 6.04 6.04 0 0 0-.73-7.01zm-9.02 12.6a4.48 4.48 0 0 1-2.87-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17.02.05v5.58a4.5 4.5 0 0 1-4.48 4.5zM3.6 18.5a4.45 4.45 0 0 1-.53-3l.14.08 4.78 2.76a.78.78 0 0 0 .79 0l5.84-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.16-1.65zM2.34 8.04a4.48 4.48 0 0 1 2.34-1.97v5.66a.78.78 0 0 0 .39.68l5.81 3.35-2.02 1.17a.06.06 0 0 1-.06 0L3.95 14.13a4.5 4.5 0 0 1-1.61-6.09zm16.6 3.86L13.1 8.51l2.02-1.17a.06.06 0 0 1 .06 0l4.83 2.8a4.5 4.5 0 0 1-.69 8.13v-5.66a.78.78 0 0 0-.4-.7zm2-3 .14.08-.14-.08-4.78-2.78a.79.79 0 0 0-.79 0L9.53 9.49V7.16a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.69 4.66zm-12.65 4.13-2.02-1.17a.06.06 0 0 1-.03-.05V6.13a4.5 4.5 0 0 1 7.39-3.46l-.14.08L8.7 5.5a.78.78 0 0 0-.4.68zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
      </svg>
    );
  }
  if (provider === 'anthropic') {
    return (
      <svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
        <path d="M14.43 4h-3.32l5.06 16h3.32L14.43 4zM7.4 4 2 20h3.4l1.07-3.39h5.29L12.86 20h3.4L10.86 4H7.4zm.05 9.61 1.85-5.85 1.85 5.85H7.45z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" class={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2 1 21h22L12 2zm0 4.6 7.6 13.2H4.4L12 6.6z" />
    </svg>
  );
};

export const ChatTab: FunctionalComponent<ChatTabProps> = ({ onOpenSettings, isActive = true }) => {
  const toolPermissions = useStore((s) => s.toolPermissions);

  // Per-provider key state. null = still loading.
  const [keys, setKeys] = useState<Record<ProviderId, string> | null>(null);
  const [provider, setProvider] = useState<ProviderId>(DEFAULT_PROVIDER);
  const [model, setModel] = useState<string>(DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER]);
  // The custom-model input lives outside the dropdown when in custom mode.
  const [customModel, setCustomModel] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const transcriptRef = useRef<CanonicalMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Generation counter — bumped any time the conversation context is reset
  // (Clear button or provider switch). Each dispatched send() captures the
  // generation it belongs to and refuses to mutate transcriptRef / push
  // entries once the generation has advanced. Without this, a long-running
  // tool call resolves *after* the user has switched provider or cleared
  // the chat, and pollutes the new context with the previous one's output
  // (Anthropic tool_use frames into an OpenAI transcript, an assistant
  // response inside a freshly-emptied chat, etc.).
  const runIdRef = useRef(0);

  // ---------- Load persisted state ----------
  useEffect(() => {
    chrome.storage.local.get(
      [
        'openaiApiKey',
        'anthropicApiKey',
        'geminiApiKey',
        'chatProvider',
        'chatModel',
        'chatCustomModel',
      ],
      (data) => {
        const next: Record<ProviderId, string> = {
          openai: typeof data.openaiApiKey === 'string' ? data.openaiApiKey : '',
          anthropic: typeof data.anthropicApiKey === 'string' ? data.anthropicApiKey : '',
          gemini: typeof data.geminiApiKey === 'string' ? data.geminiApiKey : '',
        };
        setKeys(next);
        const persistedProvider =
          typeof data.chatProvider === 'string' && PROVIDER_ORDER.includes(data.chatProvider as ProviderId)
            ? (data.chatProvider as ProviderId)
            : DEFAULT_PROVIDER;
        setProvider(persistedProvider);
        const persistedModel =
          typeof data.chatModel === 'string' && data.chatModel
            ? data.chatModel
            : DEFAULT_MODEL_BY_PROVIDER[persistedProvider];
        const knownIds = new Set(MODELS_BY_PROVIDER[persistedProvider].map((m) => m.id));
        if (knownIds.has(persistedModel)) {
          setModel(persistedModel);
          setIsCustomMode(false);
        } else {
          setModel(CUSTOM_OPTION_VALUE);
          setCustomModel(persistedModel);
          setIsCustomMode(true);
        }
        if (typeof data.chatCustomModel === 'string') setCustomModel(data.chatCustomModel);
      },
    );
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      setKeys((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (changes.openaiApiKey) next.openai = (changes.openaiApiKey.newValue as string) ?? '';
        if (changes.anthropicApiKey) next.anthropic = (changes.anthropicApiKey.newValue as string) ?? '';
        if (changes.geminiApiKey) next.gemini = (changes.geminiApiKey.newValue as string) ?? '';
        return next;
      });
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // ---------- Persist provider+model selection ----------
  const persistSelection = (p: ProviderId, m: string, custom: string) => {
    void chrome.storage.local.set({
      chatProvider: p,
      chatModel: m === CUSTOM_OPTION_VALUE ? custom : m,
      chatCustomModel: custom,
    });
  };

  const onProviderChange = (p: ProviderId) => {
    if (p === provider) return;
    // Abort any in-flight send before we change provider context — without
    // this the still-running runChat resolves into the new transcript shape
    // with the previous provider's tool_use/tool_calls frames, breaking the
    // next turn. The runIdRef bump below also makes the late resolution a
    // no-op (defense in depth).
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setBusy(false);
    setProvider(p);
    setIsCustomMode(false);
    const fallback = DEFAULT_MODEL_BY_PROVIDER[p];
    setModel(fallback);
    persistSelection(p, fallback, customModel);
    setKeyDraft('');
    // Reset the canonical-message buffer because each provider has its own
    // message shape (Anthropic tool_use vs OpenAI tool_calls vs Gemini parts)
    // and replaying one shape into another fails. The visible transcript
    // (`entries`) is preserved so the user keeps their conversation history;
    // the next send starts a fresh API conversation with the new provider.
    transcriptRef.current = [];
  };

  const onModelChange = (id: string) => {
    if (id === CUSTOM_OPTION_VALUE) {
      setModel(id);
      setIsCustomMode(true);
      persistSelection(provider, id, customModel);
    } else {
      setModel(id);
      setIsCustomMode(false);
      persistSelection(provider, id, customModel);
    }
  };

  const onCustomModelChange = (value: string) => {
    setCustomModel(value);
    persistSelection(provider, CUSTOM_OPTION_VALUE, value);
  };

  // ---------- Auto-scroll ----------
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length]);

  // When the tab becomes visible again (e.g., after the user visited Tools or
  // Settings), re-anchor the transcript scroll to the bottom. The scroll-on-
  // entries effect above is a no-op while this panel is display:none because
  // scrollHeight reports 0 for hidden elements, so any messages that arrived
  // while we were hidden would otherwise leave the user looking at the top.
  useEffect(() => {
    if (isActive) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [isActive]);

  // ---------- Save key inline ----------
  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    await chrome.storage.local.set({ [PROVIDER_META[provider].storageKey]: trimmed });
    setKeyDraft('');
    // Listener will update `keys` state.
  };

  // ---------- Send ----------
  const effectiveModel = isCustomMode ? customModel.trim() : model;
  const apiKey = keys?.[provider] ?? '';
  const canSend = apiKey.trim().length > 0 && effectiveModel.length > 0;

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy || !canSend) return;

    const userEntry: DisplayEntry = { id: crypto.randomUUID(), kind: 'user', text: trimmed };
    setEntries((prev) => [...prev, userEntry]);
    setInput('');
    setBusy(true);

    if (transcriptRef.current.length === 0) {
      transcriptRef.current = buildInitialMessages(trimmed);
    } else {
      transcriptRef.current.push({ role: 'user', text: trimmed });
    }

    const ac = new AbortController();
    abortRef.current = ac;
    // Snapshot the generation this send belongs to. Clear / provider switch
    // bumps runIdRef. We use two distinct guards downstream:
    //   - sameRun()   → ok to tear down busy/abortRef in finally even on abort
    //   - isLive()    → ok to mutate the visible transcript / push entries
    // Without this split, clicking Stop would abort the AC, isLive() flips
    // false, and the finally block would skip setBusy(false) — leaving the
    // UI stuck on "Working…" forever (caught in pre-commit critique).
    const myRunId = runIdRef.current;
    const sameRun = () => runIdRef.current === myRunId;
    const isLive = () => sameRun() && !ac.signal.aborted;

    const onToolCall = (event: ToolCallEvent) => {
      if (!isLive()) return;
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: 'tool',
          toolName: event.toolName,
          ok: event.ok,
          text: event.ok
            ? `Ran ${event.toolName} (${event.durationMs}ms)`
            : `${event.toolName} failed: ${event.errorMessage ?? 'unknown error'}`,
        },
      ]);
    };

    // Capture the tab the user is looking at right now and bind it for
    // this chat turn. Replaces the old extension-level active-tab fallback,
    // which silently re-targeted when the user switched windows mid-task.
    // If the user moves on, the agent stays on the originally-bound tab
    // (and errors with TAB_NOT_FOUND if they close it). See
    // docs/multi-profile-tab-fanout-design.md decision §2.
    let boundTabId: string | undefined;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id != null) {
        const browserId = await getBrowserInstanceId();
        boundTabId = composeTabId(browserId, activeTab.id);
      }
    } catch { /* in test envs chrome.tabs may not exist */ }

    try {
      const result = await runChat({
        provider,
        apiKey,
        model: effectiveModel,
        messages: transcriptRef.current,
        toolPermissions,
        signal: ac.signal,
        onToolCall,
        boundTabId,
      });
      if (!isLive()) return;
      transcriptRef.current.push(...result.appendedMessages);
      if (result.finalText) {
        setEntries((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: 'assistant', text: result.finalText },
        ]);
      }
    } catch (err) {
      if (!isLive()) return;
      // The chat engine already retried once (pruning old tool results) if
      // this was a context-length error — a survivor here means the retry
      // also failed. Show a friendly, actionable message instead of the raw
      // API string. Any other kind of error is shown as-is; we never want to
      // swallow or reword a real failure.
      const message = isContextLengthError(err)
        ? 'This conversation has grown too large for the model to process. Start a new conversation to continue.'
        : err instanceof Error
          ? err.message
          : 'Unknown error';
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: 'error', text: message },
      ]);
    } finally {
      // Tear down busy state on user-initiated abort (Stop) as well as
      // normal completion. sameRun() rules out the post-Clear / post-switch
      // late-arrivals (which have already had their state reset).
      if (sameRun()) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const newConversation = () => {
    // Abort the in-flight run so its result / error never resolves into the
    // freshly-empty transcript. The runIdRef bump also rejects any late
    // onToolCall events from the doomed run.
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current += 1;
    setBusy(false);
    transcriptRef.current = [];
    setEntries([]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ---------- Render ----------
  if (keys === null) {
    return <div class="p-4 text-xs text-neutral-400">Loading…</div>;
  }

  const meta = PROVIDER_META[provider];
  const models = MODELS_BY_PROVIDER[provider];
  const selectedModelOption: ModelOption | undefined = models.find((m) => m.id === model);
  const hasKey = apiKey.trim().length > 0;

  return (
    <div class="flex flex-col h-full bg-panel">
      {/* Provider + model picker bar */}
      <div class="border-b border-card-border bg-white px-3 py-2 space-y-2">
        <div class="flex items-center gap-1">
          {PROVIDER_ORDER.map((p) => {
            const m = PROVIDER_META[p];
            const active = p === provider;
            return (
              <button
                key={p}
                class={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  active
                    ? 'bg-brand-primary text-white border-brand-primary shadow-sm'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
                onClick={() => onProviderChange(p)}
                aria-pressed={active}
                title={m.label}
              >
                <ProviderIcon provider={p} className="w-3.5 h-3.5" />
                <span class="truncate">{m.label}</span>
              </button>
            );
          })}
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-neutral-500 flex-shrink-0">Model</label>
          <select
            class="flex-1 text-xs rounded border border-neutral-200 bg-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-primary"
            value={model}
            onChange={(e) => onModelChange((e.target as HTMLSelectElement).value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.tier}
              </option>
            ))}
            <option value={CUSTOM_OPTION_VALUE}>Custom…</option>
          </select>
          {entries.length > 0 && (
            <button
              class="text-xs text-neutral-500 hover:text-neutral-800 px-1"
              onClick={newConversation}
              title="Clear chat history"
              data-testid="chat-new-button"
            >
              Clear
            </button>
          )}
        </div>
        {isCustomMode && (
          <input
            type="text"
            class="w-full text-xs rounded border border-neutral-200 bg-white px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-brand-primary"
            placeholder="Type a model id (e.g. gpt-5.2-mini)"
            value={customModel}
            onInput={(e) => onCustomModelChange((e.target as HTMLInputElement).value)}
            spellcheck={false}
          />
        )}
        {selectedModelOption && !isCustomMode && (
          <p class="text-[11px] text-neutral-400 leading-tight">{selectedModelOption.notes}</p>
        )}
      </div>

      {/* Inline API key entry — shown when the active provider has no key. */}
      {!hasKey && (
        <div class="px-4 py-4 bg-white border-b border-neutral-200 space-y-3">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 rounded-full bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
              <ProviderIcon provider={provider} className="w-5 h-5 text-brand-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-neutral-900">Add your {meta.label} API key</p>
              <p class="text-xs text-neutral-500 mt-0.5">{meta.description}</p>
            </div>
          </div>
          <div class="flex gap-2">
            <input
              type="password"
              class="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-brand-primary"
              placeholder={meta.keyPlaceholder}
              value={keyDraft}
              onInput={(e) => setKeyDraft((e.target as HTMLInputElement).value)}
              autocomplete="off"
              spellcheck={false}
            />
            <button
              class="text-sm font-medium text-white bg-brand-primary px-3 rounded hover:bg-brand-primary-dark disabled:opacity-50"
              onClick={() => void saveKey()}
              disabled={keyDraft.trim().length === 0}
            >
              Save
            </button>
          </div>
          <p class="text-xs text-neutral-500">
            Stored locally — never leaves this device.{' '}
            <a
              href={meta.keyDocsUrl}
              target="_blank"
              rel="noopener"
              class="text-brand-primary hover:underline"
            >
              Get a key →
            </a>
            <span class="mx-1.5 text-neutral-300">·</span>
            <button
              class="text-brand-primary hover:underline"
              onClick={onOpenSettings}
            >
              Manage all keys
            </button>
          </p>
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} class="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {entries.length === 0 && hasKey && (
          <div class="text-xs text-neutral-400 px-1 space-y-1">
            <p>Try: <em>"go to threads.com and scrape tech.mom_ua's posts"</em></p>
            <p class="text-neutral-300">
              Using <span class="font-medium">{meta.label}</span> ·{' '}
              <span class="font-mono">{effectiveModel || '?'}</span>
            </p>
          </div>
        )}
        {entries.map((e) => (
          <ChatBubble key={e.id} entry={e} />
        ))}
        {busy && (
          <div class="text-xs text-neutral-400 italic px-1 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
            <span>Working…</span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div class="border-t border-card-border bg-white p-2">
        <div class="flex gap-2">
          <textarea
            class="flex-1 resize-none rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary disabled:bg-neutral-100"
            rows={2}
            placeholder={
              hasKey
                ? 'Ask AgentHub to do something in your browser…'
                : `Add a ${meta.label} key above to start chatting`
            }
            value={input}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
            disabled={busy || !hasKey}
            data-testid="chat-textarea"
          />
          {busy ? (
            <button
              class="text-sm font-medium text-white bg-neutral-500 px-3 rounded hover:bg-neutral-600"
              onClick={cancel}
              data-testid="chat-stop-button"
            >
              Stop
            </button>
          ) : (
            <button
              class="text-sm font-medium text-white bg-brand-primary px-3 rounded hover:bg-brand-primary-dark disabled:opacity-50"
              onClick={() => void send()}
              disabled={!input.trim() || !canSend}
              data-testid="chat-send-button"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ChatBubble: FunctionalComponent<{ entry: DisplayEntry }> = ({ entry }) => {
  if (entry.kind === 'user') {
    return (
      <div class="flex justify-end" data-testid="chat-entry" data-entry-kind="user">
        <div class="max-w-[85%] rounded-xl rounded-br-sm bg-brand-primary text-white px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.kind === 'assistant') {
    return (
      <div class="flex justify-start" data-testid="chat-entry" data-entry-kind="assistant">
        <div class="max-w-[85%] rounded-xl rounded-bl-sm bg-white border border-card-border px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.kind === 'tool') {
    return (
      <div class="flex justify-start" data-testid="chat-entry" data-entry-kind="tool">
        <div
          class={`text-xs px-2.5 py-1 rounded-md border font-mono ${
            entry.ok
              ? 'bg-neutral-50 border-card-border text-neutral-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
          data-testid="chat-tool-call"
          data-tool-name={entry.toolName ?? ''}
          data-tool-ok={entry.ok ? 'true' : 'false'}
        >
          <span class={entry.ok ? 'text-status-connected' : 'text-red-600'}>{entry.ok ? '✓' : '✗'}</span> {entry.text}
        </div>
      </div>
    );
  }
  return (
    <div class="flex justify-start" data-testid="chat-entry" data-entry-kind="error">
      <div class="max-w-[85%] rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
        {entry.text}
      </div>
    </div>
  );
};
