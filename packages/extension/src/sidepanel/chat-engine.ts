// Provider-agnostic chat engine. Drives a single user turn through up to N
// rounds of tool calls. The provider adapter is responsible for the wire
// shape; this loop only sees canonical messages.

import { filterEnabledTools } from './openai-tools.js';
import { getProvider } from './providers/index.js';
import { logRecord } from '../shared/logger.js';
import type {
  CanonicalMessage,
  ProviderId,
  CanonicalToolCall,
  ProviderCallResult,
} from './providers/types.js';

const MAX_TOOL_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an in-browser assistant inside a Chrome extension named "AgentHub". You can drive the user's browser through function calls — navigating, clicking, reading pages, scraping data, filling forms, and taking screenshots — to do whatever the user asks.

Guidelines:
- Use tools instead of describing what you would do. The user expects you to act on their behalf in their browser.
- Before filling a form you do not know, call read_form first.
- For scraping or "get me data from X" tasks: navigate first if needed, then use extract_data (preferred) or extract_table.
- After acting, briefly tell the user what you did and what you found. Be concise.
- If a tool returns an error, try a different approach (different selector, different tool) before giving up.
- The user can see their browser. Do not paste large amounts of raw scraped HTML back to them — summarise.
- get_page_content supports offset/max_chars pagination for long or infinite-scroll pages — call it repeatedly with an increasing offset instead of expecting one call to return the whole page.`;

export type { CanonicalMessage } from './providers/types.js';
export type { ProviderId } from './providers/types.js';

export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  errorMessage?: string;
}

export interface RunChatOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: CanonicalMessage[];
  toolPermissions: Record<string, boolean>;
  signal?: AbortSignal;
  onToolCall?: (event: ToolCallEvent) => void;
  /**
   * Tab the user is talking about. Captured by the side panel at
   * message-send time and injected into every tool call's `tab_id` arg if
   * the LLM didn't supply one. This replaces the old extension-level
   * "active tab" fallback, which silently re-targeted when the user
   * switched windows mid-task.
   */
  boundTabId?: string;
}

export interface RunChatResult {
  appendedMessages: CanonicalMessage[];
  finalText: string;
}

export const buildInitialMessages = (userMessage: string): CanonicalMessage[] => [
  { role: 'system', text: SYSTEM_PROMPT },
  { role: 'user', text: userMessage },
];

const DISPATCH_TIMEOUT_MS = 30_000;

const dispatchToolViaBackground = async (
  name: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: { message: string; code: string } }> => {
  // Race the message round-trip against a hard timeout. A wedged or mid-
  // eviction service worker can otherwise hang the chat indefinitely with
  // no way for the user to recover except closing the side panel.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'dispatch_tool', name, params }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Background dispatch timed out after ${DISPATCH_TIMEOUT_MS}ms`)),
          DISPATCH_TIMEOUT_MS,
        );
      }),
    ]);
    if (!response || typeof response !== 'object') {
      return { ok: false, error: { message: 'No response from background service worker', code: 'CONTENT_UNAVAILABLE' } };
    }
    return response as { ok: true; result: unknown } | { ok: false; error: { message: string; code: string } };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: (err as Error).message ?? 'Background dispatch failed',
        code: 'BACKGROUND_TIMEOUT',
      },
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

// Matches the Anthropic "prompt is too long: N tokens > 200000" family of
// invalid_request_error messages, plus similar phrasing other providers might
// use, without misfiring on unrelated 400s (e.g. a malformed tool schema).
const CONTEXT_LENGTH_PATTERN = /prompt is too long|exceeds.*context|context.*(window|length)/i;

/** An Error augmented with `status`/`errorType` the way anthropic.ts throws it. */
type ProviderCallError = Error & { status?: number; errorType?: string };

export const isContextLengthError = (err: unknown): err is ProviderCallError => {
  if (!(err instanceof Error)) return false;
  const augmented = err as ProviderCallError;
  return augmented.errorType === 'invalid_request_error' && CONTEXT_LENGTH_PATTERN.test(err.message);
};

/** Matches the placeholder pruneOldToolResults writes in place of a cleared
 * tool result's text. Used to detect an ALREADY-cleared entry so a second
 * prune pass (a later iteration's retry, after an earlier iteration already
 * cleared some entries) doesn't re-wrap it and report the placeholder's own
 * ~20-30 char length as if it were the original content size. */
const CLEARED_PLACEHOLDER_PATTERN = /^\[cleared: was \d+ chars\]$/;

/** Shared turn-indexing helper: a turn is the contiguous run of tool-result
 * messages produced by one assistant tool-calling round. Returns a
 * per-position turn index (-1 for non-tool messages) and the total turn
 * count. Factored out so pruneOldToolResults and its stats summary can never
 * drift apart on what "a turn" means. */
const computeToolTurnIndices = (
  conversation: CanonicalMessage[],
): { turnIndexByPosition: number[]; totalTurns: number } => {
  const turnIndexByPosition: number[] = new Array(conversation.length).fill(-1);
  let turnIndex = -1;
  for (let i = 0; i < conversation.length; i++) {
    if (conversation[i].role !== 'tool') continue;
    if (i === 0 || conversation[i - 1].role !== 'tool') turnIndex++;
    turnIndexByPosition[i] = turnIndex;
  }
  return { turnIndexByPosition, totalTurns: turnIndex + 1 };
};

/**
 * Clears the text of every tool-result message that isn't part of the last
 * two "turns" (a turn = the contiguous run of tool-result messages produced
 * by one assistant tool-calling round). Assistant/user messages are left
 * fully intact — only tool-result bodies are prunable, since those are what
 * accumulate unbounded over a long agentic session.
 *
 * Idempotent on already-cleared entries: an entry whose text already matches
 * the `[cleared: was N chars]` placeholder (from an earlier prune pass, e.g.
 * a prior iteration's retry) is left untouched rather than re-wrapped —
 * there's nothing left to gain from re-clearing an already-minimal
 * placeholder, and re-wrapping it would misreport the placeholder's own tiny
 * length as the original content size.
 */
export const pruneOldToolResults = (conversation: CanonicalMessage[]): CanonicalMessage[] => {
  const { turnIndexByPosition, totalTurns } = computeToolTurnIndices(conversation);
  const keepFromTurn = totalTurns - 2; // last 2 turns kept intact
  return conversation.map((m, i) => {
    if (m.role !== 'tool' || turnIndexByPosition[i] >= keepFromTurn) return m;
    if (CLEARED_PLACEHOLDER_PATTERN.test(m.text)) return m; // already cleared — nothing to gain
    return { ...m, text: `[cleared: was ${m.text.length} chars]` };
  });
};

/** Structured counts describing one prune pass, for the
 * `ext.chat.context.pruned` log event — counts/sizes only, per the
 * project's redaction law (never raw tool-result content or page text). */
interface PruneStats {
  totalTurns: number;
  turnsCleared: number;
  turnsKept: number;
  charsRemoved: number;
}

/** Diff `conversation` against `pruneOldToolResults(conversation)` to derive
 * loggable counts, without duplicating pruneOldToolResults's own
 * already-cleared/turn-boundary logic (and so can never drift from what it
 * actually did — including correctly NOT double-counting entries the minor
 * idempotency fix above already left untouched). */
const summarizePrune = (conversation: CanonicalMessage[], pruned: CanonicalMessage[]): PruneStats => {
  const { turnIndexByPosition, totalTurns } = computeToolTurnIndices(conversation);
  const clearedTurns = new Set<number>();
  let charsRemoved = 0;
  for (let i = 0; i < conversation.length; i++) {
    if (conversation[i].role !== 'tool') continue;
    if (conversation[i].text !== pruned[i].text) {
      clearedTurns.add(turnIndexByPosition[i]);
      charsRemoved += conversation[i].text.length - pruned[i].text.length;
    }
  }
  return {
    totalTurns,
    turnsCleared: clearedTurns.size,
    turnsKept: totalTurns - clearedTurns.size,
    charsRemoved,
  };
};

const toolResultToString = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return JSON.stringify(result);
  const obj = result as { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);
  const parts = obj.content.map((c) => {
    if (c.type === 'text' && typeof c.text === 'string') return c.text;
    if (c.type === 'image') return `[screenshot captured: ${c.mimeType ?? 'image'}]`;
    return JSON.stringify(c);
  });
  return parts.join('\n');
};

export const runChat = async (options: RunChatOptions): Promise<RunChatResult> => {
  const { provider, apiKey, model, messages, toolPermissions, signal, onToolCall, boundTabId } = options;

  if (!apiKey) {
    throw new Error('No API key configured for the selected provider.');
  }

  const client = getProvider(provider);
  const tools = filterEnabledTools(toolPermissions);
  const conversation: CanonicalMessage[] = [...messages];
  const appended: CanonicalMessage[] = [];
  let finalText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (signal?.aborted) throw new Error('Cancelled');

    let response: ProviderCallResult;
    try {
      response = await client.callOnce({
        apiKey,
        model,
        messages: conversation,
        tools,
        signal,
      });
    } catch (err) {
      if (!isContextLengthError(err)) throw err;
      // One local prune-and-retry: clear tool-result bodies from all but the
      // last 2 turns, then retry once with the pruned conversation. If the
      // retry also fails (same or a different error), let it propagate — we
      // don't loop this indefinitely. This is lossy (it discards prior tool
      // output) so it MUST be logged — a structured event, not raw content,
      // per the redaction law — so a stuck/confused chat is debuggable from
      // extension.log instead of a silent mystery.
      const pruned = pruneOldToolResults(conversation);
      const stats = summarizePrune(conversation, pruned);
      conversation.length = 0;
      conversation.push(...pruned);
      try {
        response = await client.callOnce({
          apiKey,
          model,
          messages: conversation,
          tools,
          signal,
        });
        void logRecord({
          event: 'ext.chat.context.pruned',
          totalTurns: stats.totalTurns,
          turnsCleared: stats.turnsCleared,
          turnsKept: stats.turnsKept,
          charsRemoved: stats.charsRemoved,
          retrySucceeded: true,
        });
      } catch (retryErr) {
        void logRecord({
          event: 'ext.chat.context.pruned',
          lvl: 'warn',
          totalTurns: stats.totalTurns,
          turnsCleared: stats.turnsCleared,
          turnsKept: stats.turnsKept,
          charsRemoved: stats.charsRemoved,
          retrySucceeded: false,
        });
        throw retryErr;
      }
    }

    const assistantMessage: CanonicalMessage = {
      role: 'assistant',
      text: response.assistantText,
      ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
    };
    conversation.push(assistantMessage);
    appended.push(assistantMessage);

    if (response.toolCalls.length === 0) {
      finalText = response.assistantText;
      break;
    }

    for (const call of response.toolCalls) {
      if (signal?.aborted) throw new Error('Cancelled');
      await runOneTool(call, conversation, appended, onToolCall, boundTabId);
    }

    if (iteration === MAX_TOOL_ITERATIONS - 1) {
      finalText = response.assistantText || 'Reached the tool-call limit before finishing. Try a smaller request.';
    }
  }

  return { appendedMessages: appended, finalText };
};

const runOneTool = async (
  call: CanonicalToolCall,
  conversation: CanonicalMessage[],
  appended: CanonicalMessage[],
  onToolCall?: (event: ToolCallEvent) => void,
  boundTabId?: string,
): Promise<void> => {
  const start = Date.now();

  // Inject the panel-bound tab id when the LLM didn't supply one. We only
  // fill in tab_id (and only for tools other than list_tabs, which is a
  // global query). Replaces the old extension-level active-tab fallback.
  // Also treats a hallucinated tab_id of 0 / negative / non-finite as
  // "missing" — real Chrome tab IDs are never <= 0, and getTab()/parseTabId()
  // (shared with the MCP/bridge path) already rejects 0 as invalid, so
  // passing it through verbatim would surface a confusing "tab_id is
  // required" error instead of just using the bound tab.
  const args: Record<string, unknown> = { ...call.args };
  const isMissingTabId =
    args.tab_id === undefined ||
    args.tab_id === null ||
    args.tab_id === '' ||
    (typeof args.tab_id === 'number' && (!Number.isFinite(args.tab_id) || args.tab_id <= 0));
  if (boundTabId && call.name !== 'list_tabs' && isMissingTabId) {
    args.tab_id = boundTabId;
  }

  const dispatched = await dispatchToolViaBackground(call.name, args);
  const durationMs = Date.now() - start;

  const toolMessage: CanonicalMessage = {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    text: dispatched.ok
      ? toolResultToString(dispatched.result)
      : `Error (${dispatched.error.code}): ${dispatched.error.message}`,
  };
  conversation.push(toolMessage);
  appended.push(toolMessage);

  onToolCall?.({
    toolName: call.name,
    args: call.args,
    ok: dispatched.ok,
    durationMs,
    errorMessage: dispatched.ok ? undefined : dispatched.error.message,
  });
};

// Exposed for tests only.
export const _internal = { runOneTool };
