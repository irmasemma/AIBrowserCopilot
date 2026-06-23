import { toGeminiTools, type GeminiToolBlock } from './schema-adapters.js';
import type {
  CanonicalMessage,
  ProviderCallArgs,
  ProviderCallResult,
  ProviderClient,
} from './types.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type Part =
  | { text: string }
  | { functionCall: { id?: string; name: string; args?: Record<string, unknown> } }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } };

interface GeminiWireMessage {
  role: 'user' | 'model';
  parts: Part[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: Part[] };
    finishReason?: string;
  }>;
  error?: { code: number; message: string; status?: string };
}

/**
 * Gemini differs from OpenAI/Anthropic in:
 *  - `system` is `systemInstruction` at top level (single object, not array).
 *  - Assistant role is `'model'` (not `'assistant'`).
 *  - Tool results are role:'user' with a `functionResponse` part.
 *  - `id` on functionCall/functionResponse is OPTIONAL in older versions,
 *    REQUIRED in Gemini 2 when present in the call. We mirror what the model
 *    sent back if it provided an id; otherwise use the synthetic one we issued.
 */
const buildWire = (
  messages: CanonicalMessage[],
): {
  systemInstruction?: { role: 'user'; parts: Part[] };
  contents: GeminiWireMessage[];
} => {
  const systemParts: string[] = [];
  const contents: GeminiWireMessage[] = [];

  const pushParts = (role: 'user' | 'model', parts: Part[]) => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.text) systemParts.push(m.text);
      continue;
    }
    if (m.role === 'tool') {
      // Wrap the textual tool result in a {result: ...} object — Gemini expects
      // a JSON object, not a bare string.
      const part: Part = {
        functionResponse: {
          ...(m.toolCallId ? { id: m.toolCallId } : {}),
          name: m.toolName ?? 'unknown',
          response: { result: m.text },
        },
      };
      pushParts('user', [part]);
      continue;
    }
    if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { id: tc.id, name: tc.name, args: tc.args } });
      }
      pushParts('model', parts);
      continue;
    }
    // user
    if (m.text) pushParts('user', [{ text: m.text }]);
  }

  const systemInstruction = systemParts.length
    ? { role: 'user' as const, parts: [{ text: systemParts.join('\n\n') }] as Part[] }
    : undefined;

  return { systemInstruction, contents };
};

const parseResponse = (data: GeminiResponse): ProviderCallResult => {
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  let assistantText = '';
  const toolCalls: ProviderCallResult['toolCalls'] = [];
  let syntheticIdCounter = 0;
  for (const p of parts) {
    if ('text' in p && typeof p.text === 'string') {
      assistantText += p.text;
    } else if ('functionCall' in p) {
      const fc = p.functionCall;
      toolCalls.push({
        id: fc.id ?? `gemini_call_${++syntheticIdCounter}`,
        name: fc.name,
        args: fc.args ?? {},
      });
    }
  }
  const raw = candidate?.finishReason;
  let finishReason: ProviderCallResult['finishReason'];
  // Gemini doesn't have a dedicated "tool_use" finish reason — presence of a
  // functionCall part is the signal.
  if (toolCalls.length > 0) finishReason = 'tool_use';
  else if (raw === 'STOP') finishReason = 'stop';
  else if (raw === 'MAX_TOKENS') finishReason = 'length';
  else finishReason = 'other';
  return { assistantText, toolCalls, finishReason };
};

export const callGemini = async (args: ProviderCallArgs): Promise<ProviderCallResult> => {
  const { apiKey, model, messages, tools, signal } = args;

  const { systemInstruction, contents } = buildWire(messages);
  const wireTools: GeminiToolBlock[] = toGeminiTools(tools);

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (wireTools.length > 0) body.tools = wireTools;

  // Query-param auth avoids CORS preflight (no custom header → simple request).
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const msg = data?.error?.message ?? `Gemini request failed (${response.status})`;
    throw new Error(msg);
  }

  return parseResponse(data);
};

export const _internal = { buildWire, parseResponse };

export const geminiClient: ProviderClient = {
  id: 'gemini',
  label: 'Google Gemini',
  callOnce: callGemini,
};
