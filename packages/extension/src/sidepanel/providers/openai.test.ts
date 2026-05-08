import { describe, expect, it } from 'vitest';
import { _internal } from './openai.js';
import type { CanonicalMessage } from './types.js';

const { toWireMessages, safeParseArgs, mapFinishReason } = _internal;

describe('OpenAI toWireMessages', () => {
  it('passes through plain text turns', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'system', text: 'sys' },
      { role: 'user', text: 'hi' },
    ];
    expect(toWireMessages(msgs)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('emits tool_calls on assistant messages', () => {
    const msgs: CanonicalMessage[] = [
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'call_1', name: 'foo', args: { x: 1 } }],
      },
    ];
    const out = toWireMessages(msgs);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'foo', arguments: '{"x":1}' } },
      ],
    });
  });

  it('emits tool result with tool_call_id and name', () => {
    const msgs: CanonicalMessage[] = [
      { role: 'tool', text: 'OK', toolCallId: 'call_1', toolName: 'foo' },
    ];
    expect(toWireMessages(msgs)).toEqual([
      { role: 'tool', content: 'OK', tool_call_id: 'call_1', name: 'foo' },
    ]);
  });
});

describe('OpenAI safeParseArgs', () => {
  it('parses valid JSON object', () => {
    expect(safeParseArgs('{"x":1}')).toEqual({ x: 1 });
  });
  it('returns empty object on invalid JSON', () => {
    expect(safeParseArgs('not json')).toEqual({});
  });
  it('returns empty object on non-object JSON', () => {
    expect(safeParseArgs('[1,2,3]')).toEqual({});
    expect(safeParseArgs('null')).toEqual({});
  });
});

describe('OpenAI mapFinishReason', () => {
  it('maps tool_calls → tool_use', () => {
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
  });
  it('maps stop → stop', () => {
    expect(mapFinishReason('stop')).toBe('stop');
  });
  it('maps length → length', () => {
    expect(mapFinishReason('length')).toBe('length');
  });
  it('maps unknown → other', () => {
    expect(mapFinishReason('content_filter')).toBe('other');
    expect(mapFinishReason('')).toBe('other');
  });
});
