import { describe, expect, it } from 'vitest';
import { _internal } from './anthropic.js';
import type { CanonicalMessage } from './types.js';

const { buildWire, parseResponse } = _internal;

describe('Anthropic buildWire', () => {
  it('extracts system message into top-level system field', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', text: 'be helpful' },
      { role: 'user', text: 'hi' },
    ];
    const { system, wire } = buildWire(msgs);
    expect(system).toBe('be helpful');
    expect(wire).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('joins multiple system messages with double newlines', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', text: 'A' },
      { role: 'system', text: 'B' },
      { role: 'user', text: 'hi' },
    ];
    const { system } = buildWire(msgs);
    expect(system).toBe('A\n\nB');
  });

  it('represents an assistant tool_use turn correctly', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'weather?' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 't1', name: 'get_weather', args: { city: 'Tokyo' } }],
      },
    ];
    const { wire } = buildWire(msgs);
    expect(wire[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'get_weather', input: { city: 'Tokyo' } }],
    });
  });

  it('wraps tool result in user role with tool_result block', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'weather?' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 't1', name: 'get_weather', args: {} }],
      },
      { role: 'tool', text: '14c', toolCallId: 't1', toolName: 'get_weather' },
    ];
    const { wire } = buildWire(msgs);
    expect(wire).toHaveLength(3);
    expect(wire[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: '14c' }],
    });
  });

  it('coalesces consecutive same-role messages into a single turn', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'hello' },
      { role: 'user', text: 'world' },
    ];
    const { wire } = buildWire(msgs);
    expect(wire).toHaveLength(1);
    expect(wire[0].content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ]);
  });

  it('mixes text and tool_use blocks in one assistant turn', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        text: 'Calling now.',
        toolCalls: [{ id: 't1', name: 'foo', args: {} }],
      },
    ];
    const { wire } = buildWire(msgs);
    expect(wire[0].content).toEqual([
      { type: 'text', text: 'Calling now.' },
      { type: 'tool_use', id: 't1', name: 'foo', input: {} },
    ]);
  });

  it('skips empty assistant turns (no text, no tool_calls)', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: '' },
    ];
    const { wire } = buildWire(msgs);
    expect(wire).toHaveLength(1);
    expect(wire[0].role).toBe('user');
  });
});

describe('Anthropic parseResponse', () => {
  it('extracts plain text when stop_reason is end_turn', () => {
    const result = parseResponse({
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
    });
    expect(result).toEqual({
      assistantText: 'Hello!',
      toolCalls: [],
      finishReason: 'stop',
    });
  });

  it('extracts tool_use blocks when stop_reason is tool_use', () => {
    const result = parseResponse({
      content: [{ type: 'tool_use', id: 't1', name: 'foo', input: { x: 1 } }],
      stop_reason: 'tool_use',
    });
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'foo', args: { x: 1 } }]);
    expect(result.finishReason).toBe('tool_use');
    expect(result.assistantText).toBe('');
  });

  it('handles mixed text + tool_use in one response (concatenates text)', () => {
    const result = parseResponse({
      content: [
        { type: 'text', text: 'Let me check. ' },
        { type: 'tool_use', id: 't1', name: 'foo', input: {} },
      ],
      stop_reason: 'tool_use',
    });
    expect(result.assistantText).toBe('Let me check. ');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.finishReason).toBe('tool_use');
  });

  it('maps max_tokens → length', () => {
    const result = parseResponse({ content: [], stop_reason: 'max_tokens' });
    expect(result.finishReason).toBe('length');
  });

  it('maps unknown stop_reason → other', () => {
    const result = parseResponse({ content: [], stop_reason: 'stop_sequence' });
    expect(result.finishReason).toBe('other');
  });

  it('handles empty content array', () => {
    const result = parseResponse({ content: [], stop_reason: 'end_turn' });
    expect(result).toEqual({ assistantText: '', toolCalls: [], finishReason: 'stop' });
  });
});
