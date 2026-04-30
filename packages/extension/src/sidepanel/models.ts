// Curated list of OpenAI models that support function calling. Users can also type a
// custom model id via the "Custom…" option for newer models we haven't listed yet.

export interface ModelOption {
  id: string;
  label: string;
  // Rough cost tier for at-a-glance comparison ($ = cheapest).
  tier: '$' | '$$' | '$$$';
  notes: string;
}

export const MODELS: ModelOption[] = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', tier: '$', notes: 'Cheap, fast — default' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tier: '$', notes: 'Newer, cheap' },
  { id: 'gpt-4o', label: 'GPT-4o', tier: '$$$', notes: 'Flagship, multimodal' },
  { id: 'gpt-4.1', label: 'GPT-4.1', tier: '$$$', notes: 'Newer flagship' },
  { id: 'o3-mini', label: 'o3-mini', tier: '$$', notes: 'Reasoning model' },
];

export const DEFAULT_MODEL_ID = 'gpt-4o-mini';

export const CUSTOM_OPTION_VALUE = '__custom__';
