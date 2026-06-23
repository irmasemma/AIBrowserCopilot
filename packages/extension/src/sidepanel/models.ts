// Curated model lists per provider. Users can also type a custom model id
// via the "Custom…" option for newer or fine-tuned models.
//
// Last reviewed: May 2026. Sources for each provider:
//   - OpenAI: openai-python SDK v2.36.0 ChatModel TypeAlias
//   - Anthropic: docs.anthropic.com/en/docs/about-claude/models
//   - Google: ai.google.dev/gemini-api/docs/models

import type { ProviderId } from './providers/types.js';

export interface ModelOption {
  id: string;
  label: string;
  /** Rough cost tier ($ = cheapest). */
  tier: '$' | '$$' | '$$$';
  notes: string;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Where the user can get an API key. */
  keyDocsUrl: string;
  /** Storage key in chrome.storage.local for this provider's API key. */
  storageKey: string;
  /** Pretty placeholder/example for the API key input. */
  keyPlaceholder: string;
  /** Short blurb shown above the key input. */
  description: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyDocsUrl: 'https://platform.openai.com/api-keys',
    storageKey: 'openaiApiKey',
    keyPlaceholder: 'sk-…',
    description: 'GPT-4.1, GPT-5, o3, o4-mini. Get a key at platform.openai.com/api-keys.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyDocsUrl: 'https://console.anthropic.com/settings/keys',
    storageKey: 'anthropicApiKey',
    keyPlaceholder: 'sk-ant-…',
    description: 'Claude Opus, Sonnet, Haiku. Get a key at console.anthropic.com.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyDocsUrl: 'https://aistudio.google.com/app/apikey',
    storageKey: 'geminiApiKey',
    keyPlaceholder: 'AIza…',
    description: 'Gemini 2.5 Pro, Flash, Flash-Lite. Get a key at aistudio.google.com.',
  },
};

export const MODELS_BY_PROVIDER: Record<ProviderId, ModelOption[]> = {
  openai: [
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tier: '$', notes: 'Cheap, fast — recommended default' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', tier: '$', notes: 'Cheapest, fastest' },
    { id: 'gpt-4.1', label: 'GPT-4.1', tier: '$$$', notes: 'Strong agent, higher cost' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini', tier: '$$', notes: 'GPT-5 family, balanced' },
    { id: 'gpt-5', label: 'GPT-5', tier: '$$$', notes: 'GPT-5 flagship' },
    { id: 'o4-mini', label: 'o4-mini', tier: '$$', notes: 'Reasoning model' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: '$', notes: 'Cheap, fast — recommended default' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: '$$', notes: 'Strong all-rounder' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', tier: '$$$', notes: 'Flagship' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: '$$', notes: 'Older Sonnet' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', tier: '$', notes: 'Cheapest' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: '$', notes: 'Fast — recommended default' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: '$$$', notes: 'Flagship' },
  ],
};

export const DEFAULT_PROVIDER: ProviderId = 'openai';

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash',
};

export const CUSTOM_OPTION_VALUE = '__custom__';

// Legacy single-provider exports kept temporarily so call sites compile during
// the migration. Remove once chat-tab is migrated.
export const MODELS = MODELS_BY_PROVIDER.openai;
export const DEFAULT_MODEL_ID = DEFAULT_MODEL_BY_PROVIDER.openai;
