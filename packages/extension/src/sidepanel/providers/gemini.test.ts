import { describe, expect, it } from 'vitest';
import { _internal } from './gemini.js';
import type { CanonicalMessage } from './types.js';

const { buildWire, parseResponse } = _internal;

describe('Gemini buildWire', () => {
  it('lifts system messages into systemInstruction', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', text: 'be helpful' },
      { role: 'user', text: 'hi' },
    ];
    const { systemInstruction, contents } = buildWire(msgs);
    expect(systemInstruction).toEqual({ role: 'user', parts: [{ text: 'be helpful' }] });
    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('maps assistant role to "model"', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ];
    const { contents } = buildWire(msgs);
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts).toEqual([{ text: 'hello' }]);
  });

  it('emits functionCall part on assistant tool calls', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'c1', name: 'foo', args: { x: 1 } }],
      },
    ];
    const { contents } = buildWire(msgs);
    expect(contents[0]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'c1', name: 'foo', args: { x: 1 } } }],
    });
  });

  it('wraps tool results in user role with functionResponse part', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'tool', text: 'sunny', toolCallId: 'c1', toolName: 'get_weather' },
    ];
    const { contents } = buildWire(msgs);
    expect(contents[0]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'c1',
            name: 'get_weather',
            response: { result: 'sunny' },
          },
        },
      ],
    });
  });

  it('omits id from functionResponse when no toolCallId', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'tool', text: 'sunny', toolName: 'get_weather' },
    ];
    const { contents } = buildWire(msgs);
    const fr = (contents[0].parts[0] as { functionResponse: Record<string, unknown> }).functionResponse;
    expect('id' in fr).toBe(false);
    expect(fr.name).toBe('get_weather');
  });

  it('coalesces consecutive same-role messages', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'hi' },
      { role: 'user', text: 'world' },
    ];
    const { contents } = buildWire(msgs);
    expect(contents).toHaveLength(1);
    expect(contents[0].parts).toEqual([{ text: 'hi' }, { text: 'world' }]);
  });

  it('returns no systemInstruction when no system messages', () => {
    const msgs: CanonicalMessage[] = [{ role: 'user', text: 'hi' }];
    expect(buildWire(msgs).systemInstruction).toBeUndefined();
  });
});

describe('Gemini parseResponse', () => {
  it('extracts plain text', () => {
    const r = parseResponse({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Hello!' }] }, finishReason: 'STOP' }],
    });
    expect(r).toEqual({ assistantText: 'Hello!', toolCalls: [], finishReason: 'stop' });
  });

  it('extracts functionCall parts and reports tool_use even when finishReason is STOP', () => {
    const r = parseResponse({
      candidates: [
        {
          content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'foo', args: { x: 1 } } }] },
          finishReason: 'STOP',
        },
      ],
    });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'foo', args: { x: 1 } }]);
    expect(r.finishReason).toBe('tool_use');
  });

  it('synthesises an id when functionCall has none', () => {
    const r = parseResponse({
      candidates: [
        {
          content: { role: 'model', parts: [{ functionCall: { name: 'foo' } }] },
          finishReason: 'STOP',
        },
      ],
    });
    expect(r.toolCalls[0].id).toMatch(/^gemini_call_/);
  });

  it('concatenates multi-part text', () => {
    const r = parseResponse({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Hello ' }, { text: 'world' }] },
          finishReason: 'STOP',
        },
      ],
    });
    expect(r.assistantText).toBe('Hello world');
  });

  it('maps MAX_TOKENS → length', () => {
    const r = parseResponse({
      candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
    });
    expect(r.finishReason).toBe('length');
  });

  it('handles empty candidates array', () => {
    const r = parseResponse({ candidates: [] });
    expect(r).toEqual({ assistantText: '', toolCalls: [], finishReason: 'other' });
  });
});
