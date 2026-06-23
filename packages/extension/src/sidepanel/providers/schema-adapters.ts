// Convert canonical OpenAI-shaped tool definitions into each provider's wire
// format. Pure functions — adapters only. No network I/O here.

import type { OpenAIFunctionTool } from '../openai-tools.js';

// ---------- OpenAI ----------

/** OpenAI uses our canonical shape directly. */
export const toOpenAITools = (tools: OpenAIFunctionTool[]): OpenAIFunctionTool[] => tools;

// ---------- Anthropic ----------

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const toAnthropicTools = (tools: OpenAIFunctionTool[]): AnthropicTool[] =>
  tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: {
      type: 'object',
      properties: t.function.parameters.properties ?? {},
      ...(t.function.parameters.required ? { required: t.function.parameters.required } : {}),
    },
  }));

// ---------- Gemini ----------

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface GeminiToolBlock {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/**
 * Recursively strip JSON Schema fields Gemini's OpenAPI 3.03 dialect rejects.
 * Disallowed: additionalProperties, $ref, oneOf, allOf, anyOf, $schema, definitions.
 * Also normalises type strings to lowercase (Gemini accepts both, but lowercase
 * matches what the rest of our schemas already use).
 */
const sanitiseGeminiSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(sanitiseGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      key === 'additionalProperties' ||
      key === '$ref' ||
      key === '$schema' ||
      key === 'definitions' ||
      key === 'oneOf' ||
      key === 'allOf' ||
      key === 'anyOf'
    ) {
      continue;
    }
    out[key] = sanitiseGeminiSchema(value);
  }
  return out;
};

export const toGeminiTools = (tools: OpenAIFunctionTool[]): GeminiToolBlock[] => {
  if (tools.length === 0) return [];
  const declarations: GeminiFunctionDeclaration[] = tools.map((t) => {
    const params = t.function.parameters;
    const hasProps = params.properties && Object.keys(params.properties).length > 0;
    const decl: GeminiFunctionDeclaration = {
      name: t.function.name,
      description: t.function.description,
    };
    if (hasProps) {
      decl.parameters = sanitiseGeminiSchema({
        type: 'object',
        properties: params.properties,
        ...(params.required ? { required: params.required } : {}),
      }) as GeminiFunctionDeclaration['parameters'];
    }
    return decl;
  });
  return [{ functionDeclarations: declarations }];
};

// Internal helper exposed for tests.
export const _internal = { sanitiseGeminiSchema };
