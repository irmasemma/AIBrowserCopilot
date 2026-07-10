import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _internal, _resetContextManagementDisabledForTest, callAnthropic } from './anthropic.js';
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

describe('callAnthropic wire request', () => {
  beforeEach(() => {
    // The "context_management unsupported" flag is sticky for the life of the
    // module (browser session) by design — reset it between tests so one
    // test's fallback doesn't leak into the next.
    _resetContextManagementDisabledForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }),
    }) as Response;

  it('sends the context-management beta header and body field, and preserves existing headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-x',
      messages: [
        { role: 'system', text: 'be helpful' },
        { role: 'user', text: 'hi' },
      ],
      tools: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toEqual({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'context-management-2025-06-27',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
    expect(body.context_management).toEqual({ edits: [{ type: 'clear_tool_uses_20250919' }] });
  });

  it('marks the system block and the last content block of the last message as ephemeral cache breakpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-x',
      messages: [
        { role: 'system', text: 'be helpful' },
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'ok' },
        { role: 'user', text: 'second' },
      ],
      tools: [],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.system).toEqual([
      { type: 'text', text: 'be helpful', cache_control: { type: 'ephemeral' } },
    ]);
    const lastMessage = body.messages[body.messages.length - 1];
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
    // Only the last block should carry the breakpoint, not earlier ones.
    const firstUserMessage = body.messages[0];
    expect(firstUserMessage.content[0].cache_control).toBeUndefined();
  });

  it('throws an Error augmented with status and errorType on a non-OK response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'prompt is too long: 403154 tokens > 200000' },
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callAnthropic({
        apiKey: 'sk-test',
        model: 'claude-x',
        messages: [{ role: 'user', text: 'hi' }],
        tools: [],
      }),
    ).rejects.toMatchObject({
      message: 'prompt is too long: 403154 tokens > 200000',
      status: 400,
      errorType: 'invalid_request_error',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Context-management beta robustness (Finding: unconditional beta usage
// across every user-selectable Anthropic model risks a WORSE regression than
// the original incident — every message on an unsupported model would 400,
// breaking currently-working chats entirely instead of just long ones). If a
// 400 names context_management specifically, retry once without the beta,
// and remember that for the rest of the session.
// ─────────────────────────────────────────────────────────────────────────

describe('callAnthropic — context-management beta fallback', () => {
  beforeEach(() => {
    _resetContextManagementDisabledForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const contextManagementRejection = () =>
    ({
      ok: false,
      status: 400,
      json: async () => ({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: "This model does not support the 'context_management' feature (beta: context-management-2025-06-27)",
        },
      }),
    }) as Response;

  const okResponse = (text = 'hi') =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
    }) as Response;

  it('(a) a 400 naming context_management triggers exactly one retry without the beta, and the retry succeeds normally', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(contextManagementRejection())
      .mockResolvedValueOnce(okResponse('recovered'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAnthropic({
      apiKey: 'sk-test',
      model: 'claude-x',
      messages: [{ role: 'user', text: 'hi' }],
      tools: [],
    });

    expect(result.assistantText).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First attempt: beta header + context_management field present.
    const firstInit = fetchMock.mock.calls[0][1];
    expect(firstInit.headers['anthropic-beta']).toBe('context-management-2025-06-27');
    expect(JSON.parse(firstInit.body as string).context_management).toBeDefined();

    // Retry: no beta header, no context_management field — same request otherwise.
    const secondInit = fetchMock.mock.calls[1][1];
    expect(secondInit.headers['anthropic-beta']).toBeUndefined();
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.context_management).toBeUndefined();
    expect(secondBody.model).toBe('claude-x');
    expect(secondBody.messages).toEqual(JSON.parse(firstInit.body as string).messages);
  });

  it('(b) after the fallback fires once, a SUBSEQUENT call in the same session skips the beta entirely (no re-triggered 400 round-trip)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(contextManagementRejection())
      .mockResolvedValueOnce(okResponse('first-recovered'))
      .mockResolvedValueOnce(okResponse('second-call'));
    vi.stubGlobal('fetch', fetchMock);

    const args = {
      apiKey: 'sk-test',
      model: 'claude-x',
      messages: [{ role: 'user' as const, text: 'hi' }],
      tools: [],
    };

    const first = await callAnthropic(args);
    expect(first.assistantText).toBe('first-recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial 400 + fallback retry

    const second = await callAnthropic(args);
    expect(second.assistantText).toBe('second-call');
    expect(fetchMock).toHaveBeenCalledTimes(3); // ONE call this time — flag stuck, no re-triggered 400

    const thirdCallInit = fetchMock.mock.calls[2][1];
    expect(thirdCallInit.headers['anthropic-beta']).toBeUndefined();
    expect(JSON.parse(thirdCallInit.body as string).context_management).toBeUndefined();
  });

  it('(c) a 400 for an UNRELATED reason (e.g. malformed tool schema) does NOT trigger the fallback retry — propagates as before', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'tools.0.custom.name: Field required' },
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callAnthropic({
        apiKey: 'sk-test',
        model: 'claude-x',
        messages: [{ role: 'user', text: 'hi' }],
        tools: [],
      }),
    ).rejects.toMatchObject({
      message: 'tools.0.custom.name: Field required',
      status: 400,
      errorType: 'invalid_request_error',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry — the beta is still sent on the NEXT call
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['anthropic-beta']).toBe('context-management-2025-06-27');
  });
});
