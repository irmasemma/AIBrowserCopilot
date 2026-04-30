import type { FunctionalComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '../store.js';
import {
  buildInitialMessages,
  runChat,
  type ChatMessage,
  type ToolCallEvent,
} from '../openai-client.js';
import { DEFAULT_MODEL_ID } from '../models.js';

interface ChatTabProps {
  onOpenSettings: () => void;
}

interface DisplayEntry {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  toolName?: string;
  ok?: boolean;
}

export const ChatTab: FunctionalComponent<ChatTabProps> = ({ onOpenSettings }) => {
  const toolPermissions = useStore((s) => s.toolPermissions);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  // Full transcript (system + user + assistant + tool) kept for follow-up turns.
  const transcriptRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    chrome.storage.local.get('openaiApiKey', (data) => {
      setApiKey(typeof data.openaiApiKey === 'string' ? data.openaiApiKey : '');
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.openaiApiKey) {
        const next = changes.openaiApiKey.newValue;
        setApiKey(typeof next === 'string' ? next : '');
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length]);

  const send = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy || !apiKey) return;

    const userEntry: DisplayEntry = { id: crypto.randomUUID(), kind: 'user', text: trimmed };
    setEntries((prev) => [...prev, userEntry]);
    setInput('');
    setBusy(true);

    if (transcriptRef.current.length === 0) {
      transcriptRef.current = buildInitialMessages(trimmed);
    } else {
      transcriptRef.current.push({ role: 'user', content: trimmed });
    }

    const ac = new AbortController();
    abortRef.current = ac;

    const onToolCall = (event: ToolCallEvent) => {
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

    try {
      const result = await runChat({
        apiKey,
        model: DEFAULT_MODEL_ID,
        messages: transcriptRef.current,
        toolPermissions,
        signal: ac.signal,
        onToolCall,
      });
      transcriptRef.current.push(...result.appendedMessages);
      if (result.finalText) {
        setEntries((prev) => [
          ...prev,
          { id: crypto.randomUUID(), kind: 'assistant', text: result.finalText },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: 'error', text: message },
      ]);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  if (apiKey === null) {
    return <div class="p-4 text-xs text-neutral-400">Loading…</div>;
  }

  if (apiKey === '') {
    return (
      <div class="p-4 text-sm text-neutral-700 space-y-3">
        <p class="font-medium">Add an OpenAI API key to start chatting.</p>
        <p class="text-xs text-neutral-500">
          Your key is stored only on this device. Keys never leave your browser.
        </p>
        <button
          class="text-sm font-medium text-white bg-brand-primary px-3 py-2 rounded hover:bg-brand-primary-dark"
          onClick={onOpenSettings}
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full">
      <div ref={scrollRef} class="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {entries.length === 0 && (
          <div class="text-xs text-neutral-400 px-1 space-y-1">
            <p>Try: <em>"go to threads.com and scrape tech.mom_ua's posts"</em></p>
            <p class="text-neutral-300">Using GPT-4o mini.</p>
          </div>
        )}
        {entries.map((e) => (
          <ChatBubble key={e.id} entry={e} />
        ))}
        {busy && (
          <div class="text-xs text-neutral-400 italic px-1">Working…</div>
        )}
      </div>
      <div class="border-t border-neutral-200 bg-white p-2">
        <div class="flex gap-2">
          <textarea
            class="flex-1 resize-none rounded border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-primary"
            rows={2}
            placeholder="Ask CoPilot to do something in your browser…"
            value={input}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
            disabled={busy}
          />
          {busy ? (
            <button
              class="text-sm font-medium text-white bg-neutral-500 px-3 rounded hover:bg-neutral-600"
              onClick={cancel}
            >
              Stop
            </button>
          ) : (
            <button
              class="text-sm font-medium text-white bg-brand-primary px-3 rounded hover:bg-brand-primary-dark disabled:opacity-50"
              onClick={() => void send()}
              disabled={!input.trim()}
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
      <div class="flex justify-end">
        <div class="max-w-[85%] rounded-lg bg-brand-primary text-white px-3 py-2 text-sm whitespace-pre-wrap">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.kind === 'assistant') {
    return (
      <div class="flex justify-start">
        <div class="max-w-[85%] rounded-lg bg-white border border-neutral-200 px-3 py-2 text-sm whitespace-pre-wrap">
          {entry.text}
        </div>
      </div>
    );
  }
  if (entry.kind === 'tool') {
    return (
      <div class="flex justify-start">
        <div
          class={`text-xs px-2 py-1 rounded ${
            entry.ok ? 'bg-neutral-100 text-neutral-600' : 'bg-red-50 text-red-700'
          }`}
        >
          {entry.ok ? '✓' : '✗'} {entry.text}
        </div>
      </div>
    );
  }
  return (
    <div class="flex justify-start">
      <div class="max-w-[85%] rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
        {entry.text}
      </div>
    </div>
  );
};
