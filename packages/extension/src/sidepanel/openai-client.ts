// Minimal OpenAI chat agent that drives the extension's existing tool dispatcher.
// Phase 1: user-supplied API key, no streaming, no persistence beyond the session.

import { filterEnabledTools, type OpenAIFunctionTool } from './openai-tools.js';
import { DEFAULT_MODEL_ID } from './models.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_TOOL_ITERATIONS = 10;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  // OpenAI multi-turn tool-calling fields
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string; // tool name on tool messages
}

export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  errorMessage?: string;
}

export interface RunChatOptions {
  apiKey: string;
  messages: ChatMessage[];
  toolPermissions: Record<string, boolean>;
  model?: string;
  signal?: AbortSignal;
  onToolCall?: (event: ToolCallEvent) => void;
}

export interface RunChatResult {
  // Full assistant trace including any intermediate tool calls and tool responses.
  // Caller appends these to its existing message list to keep context for follow-ups.
  appendedMessages: ChatMessage[];
  // The final natural-language reply (last assistant message with text content).
  finalText: string;
}

const SYSTEM_PROMPT = `You are an in-browser assistant inside a Chrome extension named "AI Browser CoPilot". You can drive the user's browser through function calls — navigating, clicking, reading pages, scraping data, filling forms, and taking screenshots — to do whatever the user asks.

Guidelines:
- Use tools instead of describing what you would do. The user expects you to act on their behalf in their browser.
- Before filling a form you do not know, call read_form first.
- For scraping or "get me data from X" tasks: navigate first if needed, then use extract_data (preferred) or extract_table.
- After acting, briefly tell the user what you did and what you found. Be concise.
- If a tool returns an error, try a different approach (different selector, different tool) before giving up.
- The user can see their browser. Do not paste large amounts of raw scraped HTML back to them — summarise.`;

export const buildInitialMessages = (userMessage: string): ChatMessage[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userMessage },
];

const dispatchToolViaBackground = async (
  name: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: { message: string; code: string } }> => {
  const response = await chrome.runtime.sendMessage({ type: 'dispatch_tool', name, params });
  if (!response || typeof response !== 'object') {
    return { ok: false, error: { message: 'No response from background service worker', code: 'CONTENT_UNAVAILABLE' } };
  }
  return response as { ok: true; result: unknown } | { ok: false; error: { message: string; code: string } };
};

// Convert a tool result (which may be { content: [{ type: 'text' | 'image', ... }] })
// into a string the model can read. Images are summarised — gpt-4o-mini text endpoint
// can't accept inline image bytes here.
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

const safeParseArgs = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  error?: { message: string; type?: string; code?: string };
}

const callOpenAI = async (
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: OpenAIFunctionTool[],
  signal?: AbortSignal,
): Promise<OpenAIChatResponse> => {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    }),
    signal,
  });

  const data = (await response.json()) as OpenAIChatResponse;

  if (!response.ok) {
    const errMsg = data?.error?.message ?? `OpenAI request failed (${response.status})`;
    const err = new Error(errMsg);
    (err as { status?: number }).status = response.status;
    throw err;
  }

  return data;
};

export const runChat = async (options: RunChatOptions): Promise<RunChatResult> => {
  const { apiKey, messages, toolPermissions, model = DEFAULT_MODEL_ID, signal, onToolCall } = options;

  if (!apiKey) {
    throw new Error('No OpenAI API key configured. Add one in Settings.');
  }

  const tools = filterEnabledTools(toolPermissions);
  const conversation: ChatMessage[] = [...messages];
  const appended: ChatMessage[] = [];
  let finalText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await callOpenAI(apiKey, model, conversation, tools, signal);
    const choice = response.choices?.[0];
    if (!choice) throw new Error('OpenAI returned no choices');

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: choice.message.content ?? '',
      tool_calls: choice.message.tool_calls,
    };
    conversation.push(assistantMessage);
    appended.push(assistantMessage);

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalText = assistantMessage.content;
      break;
    }

    // Execute each tool call sequentially (parallel tool calls would race for the active tab).
    for (const call of toolCalls) {
      if (signal?.aborted) throw new Error('Cancelled');

      const args = safeParseArgs(call.function.arguments);
      const start = Date.now();
      const dispatched = await dispatchToolViaBackground(call.function.name, args);
      const duration = Date.now() - start;

      const toolMessage: ChatMessage = {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: dispatched.ok
          ? toolResultToString(dispatched.result)
          : `Error (${dispatched.error.code}): ${dispatched.error.message}`,
      };
      conversation.push(toolMessage);
      appended.push(toolMessage);

      onToolCall?.({
        toolName: call.function.name,
        args,
        ok: dispatched.ok,
        durationMs: duration,
        errorMessage: dispatched.ok ? undefined : dispatched.error.message,
      });
    }

    if (iteration === MAX_TOOL_ITERATIONS - 1) {
      // Hit the cap — record a final note so the user sees something.
      finalText = assistantMessage.content || 'Reached the tool-call limit before finishing. Try a smaller request.';
    }
  }

  return { appendedMessages: appended, finalText };
};
