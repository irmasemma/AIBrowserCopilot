import { toAnthropicTools, type AnthropicTool } from './schema-adapters.js';
import type {
  CanonicalMessage,
  ProviderCallArgs,
  ProviderCallResult,
  ProviderClient,
} from './types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'context-management-2025-06-27';
const DEFAULT_MAX_TOKENS = 4096;

type CacheControl = { type: 'ephemeral' };

type ContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; cache_control?: CacheControl };

interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

interface AnthropicResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  model?: string;
  error?: { type: string; message: string };
}

/**
 * Anthropic differs from OpenAI in two important ways:
 *  - `system` is a top-level field, NOT a message in the array.
 *  - A single assistant turn can mix text + tool_use blocks; tool results
 *    are sent as `role: 'user'` with a content array of `tool_result` blocks.
 *
 * We coalesce consecutive same-role messages so the wire shape always alternates
 * user→assistant→user…, which is what the API requires.
 */
const buildWire = (
  messages: CanonicalMessage[],
): { system: string | undefined; wire: AnthropicWireMessage[] } => {
  const systemParts: string[] = [];
  const wire: AnthropicWireMessage[] = [];

  const pushBlock = (role: 'user' | 'assistant', block: ContentBlock) => {
    const last = wire[wire.length - 1];
    if (last && last.role === role) {
      last.content.push(block);
    } else {
      wire.push({ role, content: [block] });
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.text) systemParts.push(m.text);
      continue;
    }
    if (m.role === 'tool') {
      pushBlock('user', {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.text,
      });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: ContentBlock[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      // Skip empty assistant turns — Anthropic rejects them.
      if (blocks.length === 0) continue;
      for (const b of blocks) pushBlock('assistant', b);
      continue;
    }
    // user
    if (m.text) pushBlock('user', { type: 'text', text: m.text });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    wire,
  };
};

const parseResponse = (data: AnthropicResponse): ProviderCallResult => {
  const blocks = data.content ?? [];
  let assistantText = '';
  const toolCalls: ProviderCallResult['toolCalls'] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      assistantText += b.text;
    } else if (b.type === 'tool_use') {
      toolCalls.push({
        id: b.id,
        name: b.name,
        args: (b.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  let finishReason: ProviderCallResult['finishReason'];
  switch (data.stop_reason) {
    case 'tool_use':
      finishReason = 'tool_use';
      break;
    case 'end_turn':
      finishReason = 'stop';
      break;
    case 'max_tokens':
      finishReason = 'length';
      break;
    default:
      finishReason = 'other';
  }
  return { assistantText, toolCalls, finishReason };
};

// Sticky, session-lifetime flag: once we've learned (via a live 400) that the
// configured API key/org/model combination doesn't support the
// context-management beta, stop sending it for the rest of this browser
// session. This repo cannot reliably verify per-model beta support ahead of
// time (see models.ts — multiple user-selectable Anthropic models, and beta
// support can vary by model/account), so the robust approach is: try with the
// beta on, detect the specific failure, fall back once, then remember the
// fallback so every subsequent call in this session skips straight to the
// no-beta shape instead of re-triggering the 400 round-trip every time.
let contextManagementDisabled = false;

/** Detect a 400 caused specifically by the context-management beta, as
 * opposed to any other invalid_request_error (malformed tool schema, bad
 * model id, etc.) — those must keep propagating unchanged, never get
 * swallowed into a silent retry. */
const isContextManagementError = (data: AnthropicResponse | undefined): boolean => {
  const msg = data?.error?.message ?? '';
  return /context[_-]management/i.test(msg);
};

const buildRequestBody = (
  wire: AnthropicWireMessage[],
  system: string | undefined,
  wireTools: AnthropicTool[],
  model: string,
  includeContextManagement: boolean,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: wire,
  };
  if (includeContextManagement) {
    // Context editing (beta): server-side clears old tool_result content
    // before the model sees the prompt, so long agentic loops don't
    // monotonically grow the request until it exceeds the model's context
    // window. See docs reference: context-management-2025-06-27.
    body.context_management = { edits: [{ type: 'clear_tool_uses_20250919' }] };
  }
  if (system) {
    body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }
  if (wireTools.length > 0) body.tools = wireTools;
  return body;
};

const buildRequestHeaders = (apiKey: string, includeContextManagement: boolean): Record<string, string> => {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  };
  if (includeContextManagement) headers['anthropic-beta'] = ANTHROPIC_BETA;
  return headers;
};

export const callAnthropic = async (args: ProviderCallArgs): Promise<ProviderCallResult> => {
  const { apiKey, model, messages, tools, signal } = args;

  const { system, wire } = buildWire(messages);
  const wireTools: AnthropicTool[] = toAnthropicTools(tools);

  // Prompt caching: mark the system prompt and the last content block of the
  // last message as cache breakpoints. Both are prefix-stable across calls
  // within a conversation (system is a static const; the last message grows
  // by appending, never mutating earlier content), so the shared prefix is
  // served from cache on every follow-up round-trip.
  if (wire.length > 0) {
    const lastMessage = wire[wire.length - 1];
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    if (lastBlock) lastBlock.cache_control = { type: 'ephemeral' };
  }

  const doFetch = async (
    includeContextManagement: boolean,
  ): Promise<{ response: Response; data: AnthropicResponse }> => {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: buildRequestHeaders(apiKey, includeContextManagement),
      body: JSON.stringify(buildRequestBody(wire, system, wireTools, model, includeContextManagement)),
      signal,
    });
    const data = (await response.json()) as AnthropicResponse;
    return { response, data };
  };

  const attemptedContextManagement = !contextManagementDisabled;
  let { response, data } = await doFetch(attemptedContextManagement);

  if (!response.ok && attemptedContextManagement && response.status === 400 && isContextManagementError(data)) {
    // Retry the SAME request once, without context_management in the body
    // and without the anthropic-beta header — and remember the decision for
    // the rest of the session so we don't pay this round-trip again.
    contextManagementDisabled = true;
    ({ response, data } = await doFetch(false));
  }

  if (!response.ok) {
    const msg = data?.error?.message ?? `Anthropic request failed (${response.status})`;
    throw Object.assign(new Error(msg), {
      status: response.status,
      errorType: data?.error?.type,
    });
  }

  return parseResponse(data);
};

// Exposed for tests
export const _internal = { buildWire, parseResponse };

/** Test-only: reset the module-level "context_management unsupported" sticky
 * flag so each test starts from a clean slate. Real callers never call this
 * — the flag is meant to persist for the life of the browser session once
 * it's set. */
export const _resetContextManagementDisabledForTest = (): void => {
  contextManagementDisabled = false;
};

export const anthropicClient: ProviderClient = {
  id: 'anthropic',
  label: 'Anthropic',
  callOnce: callAnthropic,
};
