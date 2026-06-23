import { describe, expect, it } from 'vitest';
import {
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools,
  _internal,
} from './schema-adapters.js';
import type { OpenAIFunctionTool } from '../openai-tools.js';

const sampleTools: OpenAIFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather for a city.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['c', 'f'] },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'no_args',
      description: 'A tool with no required args.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('toOpenAITools', () => {
  it('returns canonical tool list unchanged (identity mapping)', () => {
    expect(toOpenAITools(sampleTools)).toBe(sampleTools);
  });
});

describe('toAnthropicTools', () => {
  it('maps to {name, description, input_schema}', () => {
    const out = toAnthropicTools(sampleTools);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      name: 'get_weather',
      description: 'Get weather for a city.',
      input_schema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          units: { type: 'string', enum: ['c', 'f'] },
        },
        required: ['city'],
      },
    });
  });

  it('omits required when not present', () => {
    const out = toAnthropicTools(sampleTools);
    expect(out[1]).toEqual({
      name: 'no_args',
      description: 'A tool with no required args.',
      input_schema: { type: 'object', properties: {} },
    });
    expect('required' in out[1].input_schema).toBe(false);
  });
});

describe('toGeminiTools', () => {
  it('wraps declarations in functionDeclarations block', () => {
    const out = toGeminiTools(sampleTools);
    expect(out).toHaveLength(1);
    expect(out[0].functionDeclarations).toHaveLength(2);
    expect(out[0].functionDeclarations[0].name).toBe('get_weather');
  });

  it('omits parameters when there are no properties', () => {
    const out = toGeminiTools(sampleTools);
    const decl = out[0].functionDeclarations[1];
    expect(decl.name).toBe('no_args');
    expect(decl.parameters).toBeUndefined();
  });

  it('returns empty array when no tools', () => {
    expect(toGeminiTools([])).toEqual([]);
  });

  it('preserves required arrays', () => {
    const out = toGeminiTools(sampleTools);
    expect(out[0].functionDeclarations[0].parameters?.required).toEqual(['city']);
  });
});

describe('Gemini schema sanitiser', () => {
  const { sanitiseGeminiSchema } = _internal;

  it('strips additionalProperties', () => {
    expect(
      sanitiseGeminiSchema({ type: 'object', additionalProperties: false, properties: {} }),
    ).toEqual({ type: 'object', properties: {} });
  });

  it('strips $ref, $schema, definitions', () => {
    expect(
      sanitiseGeminiSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        definitions: { foo: { type: 'string' } },
        $ref: '#/definitions/foo',
      }),
    ).toEqual({});
  });

  it('strips oneOf/allOf/anyOf', () => {
    expect(
      sanitiseGeminiSchema({ oneOf: [], allOf: [], anyOf: [], type: 'string' }),
    ).toEqual({ type: 'string' });
  });

  it('recurses into nested properties', () => {
    expect(
      sanitiseGeminiSchema({
        type: 'object',
        properties: {
          nested: { type: 'object', additionalProperties: true, properties: { x: { type: 'string' } } },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { x: { type: 'string' } } },
      },
    });
  });

  it('recurses into arrays', () => {
    expect(
      sanitiseGeminiSchema({
        type: 'array',
        items: { type: 'object', additionalProperties: true, properties: {} },
      }),
    ).toEqual({
      type: 'array',
      items: { type: 'object', properties: {} },
    });
  });

  it('preserves allowed JSON Schema fields', () => {
    expect(
      sanitiseGeminiSchema({
        type: 'object',
        description: 'desc',
        properties: { x: { type: 'string', enum: ['a', 'b'] } },
        required: ['x'],
      }),
    ).toEqual({
      type: 'object',
      description: 'desc',
      properties: { x: { type: 'string', enum: ['a', 'b'] } },
      required: ['x'],
    });
  });
});
