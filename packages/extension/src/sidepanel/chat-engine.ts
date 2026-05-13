// Provider-agnostic chat engine. Drives a single user turn through up to N
// rounds of tool calls. The provider adapter is responsible for the wire
// shape; this loop only sees canonical messages.

import { filterEnabledTools } from './openai-tools.js';
import { getProvider } from './providers/index.js';
import type {
  CanonicalMessage,
  ProviderId,
  CanonicalToolCall,
} from './providers/types.js';

const MAX_TOOL_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an in-browser assistant inside a Chrome extension named "Pilotwave". You can drive the user's browser through function calls — navigating, clicking, reading pages, scraping data, filling forms, and taking screenshots — to do whatever the user asks.

Guidelines:
- Use tools instead of describing what you would do. The user expects you to act on their behalf in their browser.
- Before filling a form you do not know, call read_form first.
- For scraping or "get me data from X" tasks: navigate first if needed, then use extract_data (preferred) or extract_table.
- After acting, briefly tell the user what you did and what you found. Be concise.
- If a tool returns an error, try a different approach (different selector, different tool) before giving up.
- The user can see their browser. Do not paste large amounts of raw scraped HTML back to them — summarise.`;

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

    const response = await client.callOnce({
      apiKey,
      model,
      messages: conversation,
      tools,
      signal,
    });

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
  const args: Record<string, unknown> = { ...call.args };
  if (boundTabId && call.name !== 'list_tabs' && (args.tab_id === undefined || args.tab_id === null || args.tab_id === '')) {
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
