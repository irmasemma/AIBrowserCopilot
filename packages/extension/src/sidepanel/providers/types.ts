// Canonical (provider-agnostic) chat shapes used by the chat engine and UI.
// Per-provider adapters convert these into and out of each vendor's wire format.
//
// Design choice: keep the canonical shape minimal — text + tool calls + tool
// results — so that the agentic loop and the UI never have to care which
// provider answered. Anything provider-specific (system-prompt placement,
// content-block multiplexing, schema dialect) is an adapter detail.

export type ProviderId = 'openai' | 'anthropic' | 'gemini';

export interface CanonicalToolCall {
  /** Vendor-issued ID. Required for the follow-up tool_result message. */
  id: string;
  name: string;
  /** Pre-parsed JSON object. Empty object if the model emitted invalid JSON. */
  args: Record<string, unknown>;
}

export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain text. Empty string when this is a pure tool-call assistant turn. */
  text: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: CanonicalToolCall[];
  /** Present on tool-result turns. */
  toolCallId?: string;
  toolName?: string;
}

export interface ProviderCallResult {
  /** Assistant text content (may be empty when finishReason === 'tool_use'). */
  assistantText: string;
  /** Tool requests from the model, if any. */
  toolCalls: CanonicalToolCall[];
  /** Why the model stopped. 'tool_use' means we should run tools and loop. */
  finishReason: 'stop' | 'tool_use' | 'length' | 'other';
}

export interface ProviderCallArgs {
  apiKey: string;
  model: string;
  /**
   * Conversation including system + user + assistant + tool messages,
   * in chronological order. Adapters re-shape this for their wire format
   * (e.g. Anthropic pulls system out and merges consecutive user turns).
   */
  messages: CanonicalMessage[];
  /**
   * Canonical (OpenAI-shaped) tool definitions. Adapter converts as needed.
   * Empty array → no tools sent.
   */
  tools: import('../openai-tools.js').OpenAIFunctionTool[];
  signal?: AbortSignal;
}

export interface ProviderClient {
  id: ProviderId;
  /** Human-readable label (used in the UI for the provider selector). */
  label: string;
  /** Single round-trip to the provider. The agentic loop calls this repeatedly. */
  callOnce(args: ProviderCallArgs): Promise<ProviderCallResult>;
}
