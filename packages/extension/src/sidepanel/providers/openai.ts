import { toOpenAITools } from './schema-adapters.js';
import type {
  CanonicalMessage,
  ProviderCallArgs,
  ProviderCallResult,
  ProviderClient,
} from './types.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAIChoice {
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
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  error?: { message: string; type?: string; code?: string };
}

const toWireMessages = (messages: CanonicalMessage[]): OpenAIWireMessage[] =>
  messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.text,
        tool_call_id: m.toolCallId,
        name: m.toolName,
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.text,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return { role: m.role, content: m.text };
  });

const safeParseArgs = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

const mapFinishReason = (raw: string): ProviderCallResult['finishReason'] => {
  if (raw === 'tool_calls') return 'tool_use';
  if (raw === 'stop') return 'stop';
  if (raw === 'length') return 'length';
  return 'other';
};

export const callOpenAI = async (args: ProviderCallArgs): Promise<ProviderCallResult> => {
  const { apiKey, model, messages, tools, signal } = args;

  const wireTools = toOpenAITools(tools);
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: toWireMessages(messages),
      tools: wireTools.length > 0 ? wireTools : undefined,
      tool_choice: wireTools.length > 0 ? 'auto' : undefined,
    }),
    signal,
  });

  const data = (await response.json()) as OpenAIResponse;
  if (!response.ok) {
    const msg = data?.error?.message ?? `OpenAI request failed (${response.status})`;
    throw new Error(msg);
  }

  const choice = data.choices?.[0];
  if (!choice) throw new Error('OpenAI returned no choices');

  const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: safeParseArgs(tc.function.arguments),
  }));

  return {
    assistantText: choice.message.content ?? '',
    toolCalls,
    finishReason: mapFinishReason(choice.finish_reason),
  };
};

// Exported for tests
export const _internal = { toWireMessages, safeParseArgs, mapFinishReason };

export const openaiClient: ProviderClient = {
  id: 'openai',
  label: 'OpenAI',
  callOnce: callOpenAI,
};
