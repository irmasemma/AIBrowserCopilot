import { toAnthropicTools, type AnthropicTool } from './schema-adapters.js';
import type {
  CanonicalMessage,
  ProviderCallArgs,
  ProviderCallResult,
  ProviderClient,
} from './types.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

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

export const callAnthropic = async (args: ProviderCallArgs): Promise<ProviderCallResult> => {
  const { apiKey, model, messages, tools, signal } = args;

  const { system, wire } = buildWire(messages);
  const wireTools: AnthropicTool[] = toAnthropicTools(tools);

  const body: Record<string, unknown> = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: wire,
  };
  if (system) body.system = system;
  if (wireTools.length > 0) body.tools = wireTools;

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await response.json()) as AnthropicResponse;
  if (!response.ok) {
    const msg = data?.error?.message ?? `Anthropic request failed (${response.status})`;
    throw new Error(msg);
  }

  return parseResponse(data);
};

// Exposed for tests
export const _internal = { buildWire, parseResponse };

export const anthropicClient: ProviderClient = {
  id: 'anthropic',
  label: 'Anthropic',
  callOnce: callAnthropic,
};
