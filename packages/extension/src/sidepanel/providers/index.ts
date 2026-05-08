import { anthropicClient } from './anthropic.js';
import { geminiClient } from './gemini.js';
import { openaiClient } from './openai.js';
import type { ProviderClient, ProviderId } from './types.js';

const REGISTRY: Record<ProviderId, ProviderClient> = {
  openai: openaiClient,
  anthropic: anthropicClient,
  gemini: geminiClient,
};

export const getProvider = (id: ProviderId): ProviderClient => REGISTRY[id];
export const PROVIDERS: ProviderClient[] = [openaiClient, anthropicClient, geminiClient];

export type { ProviderClient, ProviderId } from './types.js';
