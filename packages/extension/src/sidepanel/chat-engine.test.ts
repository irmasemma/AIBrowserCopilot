import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalMessage, ProviderCallResult } from './providers/types.js';

// Mock the provider registry so runChat tests control callOnce directly
// without touching real fetch/Anthropic wire shape (that's covered in
// anthropic.test.ts).
const callOnce = vi.fn();
vi.mock('./providers/index.js', () => ({
  getProvider: () => ({ id: 'anthropic', label: 'Anthropic', callOnce }),
}));

// Mock the shared logger (same pattern as tool-dispatcher.test.ts's
// `vi.mock('../shared/logger.js', ...)`) so pruning tests can assert on the
// ext.chat.context.pruned event without touching chrome.storage.local.
vi.mock('../shared/logger.js', () => ({ logRecord: vi.fn(), logError: vi.fn() }));

// vi.mock calls are hoisted above imports by vitest, so chat-engine picks up
// the mocked provider registry and logger even though these imports appear
// after them.
import { runChat, isContextLengthError, pruneOldToolResults, _internal } from './chat-engine.js';
import { logRecord } from '../shared/logger.js';

const contextLengthError = () =>
  Object.assign(new Error('prompt is too long: 403154 tokens > 200000'), {
    status: 400,
    errorType: 'invalid_request_error',
  });

const okResult = (overrides: Partial<ProviderCallResult> = {}): ProviderCallResult => ({
  assistantText: 'done',
  toolCalls: [],
  finishReason: 'stop',
  ...overrides,
});

describe('isContextLengthError', () => {
  it('matches Anthropic-style "prompt is too long" invalid_request_error', () => {
    expect(isContextLengthError(contextLengthError())).toBe(true);
  });

  it('does not match invalid_request_error for an unrelated reason (e.g. malformed tool schema)', () => {
    const err = Object.assign(new Error('tools.0.custom.name: Field required'), {
      status: 400,
      errorType: 'invalid_request_error',
    });
    expect(isContextLengthError(err)).toBe(false);
  });

  it('does not match a non-Error value', () => {
    expect(isContextLengthError('prompt is too long')).toBe(false);
  });

  it('does not match an Error without errorType', () => {
    expect(isContextLengthError(new Error('prompt is too long: 999 tokens > 200000'))).toBe(false);
  });
});

describe('pruneOldToolResults', () => {
  it('clears tool-result text outside the last 2 turns, leaves the last 2 turns and all non-tool messages intact', () => {
    const conversation: CanonicalMessage[] = [
      { role: 'system', text: 'sys' },
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't0', name: 'a', args: {} }] },
      { role: 'tool', toolCallId: 't0', toolName: 'a', text: 'x'.repeat(50) }, // turn 0
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'b', args: {} }] },
      { role: 'tool', toolCallId: 't1', toolName: 'b', text: 'y'.repeat(60) }, // turn 1
      { role: 'assistant', text: '', toolCalls: [{ id: 't2', name: 'c', args: {} }] },
      { role: 'tool', toolCallId: 't2', toolName: 'c', text: 'z'.repeat(70) }, // turn 2 (kept)
    ];

    const pruned = pruneOldToolResults(conversation);

    expect(pruned[0]).toEqual(conversation[0]); // system intact
    expect(pruned[1]).toEqual(conversation[1]); // user intact
    expect(pruned[2]).toEqual(conversation[2]); // assistant intact
    expect(pruned[3].text).toBe('[cleared: was 50 chars]'); // turn 0 cleared (only 1 turn kept back from newest = turns 1,2)
    expect(pruned[5]).toEqual(conversation[5]); // turn 1 kept intact
    expect(pruned[7]).toEqual(conversation[7]); // turn 2 kept intact
    // Original conversation is untouched (pure function).
    expect(conversation[3].text).toHaveLength(50);
  });

  it('keeps everything intact when there are 2 or fewer tool turns', () => {
    const conversation: CanonicalMessage[] = [
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't0', name: 'a', args: {} }] },
      { role: 'tool', toolCallId: 't0', toolName: 'a', text: 'small' },
    ];
    const pruned = pruneOldToolResults(conversation);
    expect(pruned).toEqual(conversation);
  });

  it('is idempotent on an already-cleared entry — a second prune pass does not re-wrap the placeholder', () => {
    // Simulates a SECOND prune within the same conversation: iteration N
    // already cleared turn 0 into a placeholder; a later iteration's retry
    // prunes again and turn 0 still falls outside the "last 2 turns" window.
    // Re-wrapping it would report the placeholder's own ~20-char length as
    // if it were the original content size — misleading.
    const conversation: CanonicalMessage[] = [
      { role: 'user', text: 'go' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't0', name: 'a', args: {} }] },
      { role: 'tool', toolCallId: 't0', toolName: 'a', text: '[cleared: was 5000 chars]' }, // turn 0, already cleared
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'b', args: {} }] },
      { role: 'tool', toolCallId: 't1', toolName: 'b', text: 'y'.repeat(1000) }, // turn 1
      { role: 'assistant', text: '', toolCalls: [{ id: 't2', name: 'c', args: {} }] },
      { role: 'tool', toolCallId: 't2', toolName: 'c', text: 'z'.repeat(1000) }, // turn 2 (kept)
      { role: 'assistant', text: '', toolCalls: [{ id: 't3', name: 'd', args: {} }] },
      { role: 'tool', toolCallId: 't3', toolName: 'd', text: 'w'.repeat(1000) }, // turn 3 (kept)
    ];

    const pruned = pruneOldToolResults(conversation);

    // Turn 0's placeholder is left byte-identical, NOT re-wrapped as
    // "[cleared: was 25 chars]" (the placeholder's own length).
    expect(pruned[2].text).toBe('[cleared: was 5000 chars]');
    // Turn 1 now falls outside the last-2-turns window and gets cleared for
    // the first time, reporting its REAL original length.
    expect(pruned[4].text).toBe('[cleared: was 1000 chars]');
    // Turns 2 and 3 (the last 2) stay intact.
    expect(pruned[6]).toEqual(conversation[6]);
    expect(pruned[8]).toEqual(conversation[8]);
  });
});

describe('runChat prune-and-retry on context-length error', () => {
  beforeEach(() => {
    callOnce.mockReset();
    vi.mocked(logRecord).mockClear();
  });

  const bigConversation = (): CanonicalMessage[] => [
    { role: 'system', text: 'sys' },
    { role: 'user', text: 'go' },
    { role: 'assistant', text: '', toolCalls: [{ id: 't0', name: 'a', args: {} }] },
    { role: 'tool', toolCallId: 't0', toolName: 'a', text: 'x'.repeat(1000) },
    { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'b', args: {} }] },
    { role: 'tool', toolCallId: 't1', toolName: 'b', text: 'y'.repeat(1000) },
    { role: 'assistant', text: '', toolCalls: [{ id: 't2', name: 'c', args: {} }] },
    { role: 'tool', toolCallId: 't2', toolName: 'c', text: 'z'.repeat(1000) },
  ];

  it('retries once with pruned tool results and returns the successful retry result', async () => {
    callOnce
      .mockRejectedValueOnce(contextLengthError())
      .mockResolvedValueOnce(okResult({ assistantText: 'all good' }));

    const result = await runChat({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'm',
      messages: bigConversation(),
      toolPermissions: {},
    });

    expect(callOnce).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe('all good');

    // Second call's messages must have the oldest tool turn cleared but the
    // most recent 2 turns intact.
    const secondCallArgs = callOnce.mock.calls[1][0];
    const toolMsgs = (secondCallArgs.messages as CanonicalMessage[]).filter((m) => m.role === 'tool');
    expect(toolMsgs[0].text).toMatch(/^\[cleared: was \d+ chars\]$/);
    expect(toolMsgs[1].text).toBe('y'.repeat(1000));
    expect(toolMsgs[2].text).toBe('z'.repeat(1000));

    // A lossy prune MUST be logged (structured, no raw content) — success path.
    expect(logRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ext.chat.context.pruned',
        totalTurns: 3,
        turnsCleared: 1,
        turnsKept: 2,
        charsRemoved: 1000 - '[cleared: was 1000 chars]'.length,
        retrySucceeded: true,
      }),
    );
    // No raw tool-result content leaked into the log payload.
    const loggedPayload = JSON.stringify(vi.mocked(logRecord).mock.calls[0][0]);
    expect(loggedPayload).not.toContain('x'.repeat(50));
    expect(loggedPayload).not.toContain('y'.repeat(50));
    expect(loggedPayload).not.toContain('z'.repeat(50));
  });

  it('propagates the error if the retry also fails (does not loop indefinitely)', async () => {
    const secondError = Object.assign(new Error('prompt is too long: 250000 tokens > 200000'), {
      status: 400,
      errorType: 'invalid_request_error',
    });
    callOnce.mockRejectedValueOnce(contextLengthError()).mockRejectedValueOnce(secondError);

    await expect(
      runChat({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'm',
        messages: bigConversation(),
        toolPermissions: {},
      }),
    ).rejects.toBe(secondError);

    expect(callOnce).toHaveBeenCalledTimes(2);

    // A lossy prune whose retry ALSO fails must still be logged — failure path.
    expect(logRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ext.chat.context.pruned',
        totalTurns: 3,
        turnsCleared: 1,
        turnsKept: 2,
        retrySucceeded: false,
      }),
    );
    const loggedPayload = JSON.stringify(vi.mocked(logRecord).mock.calls[0][0]);
    expect(loggedPayload).not.toContain('x'.repeat(50));
    expect(loggedPayload).not.toContain('y'.repeat(50));
    expect(loggedPayload).not.toContain('z'.repeat(50));
  });

  it('propagates a non-context-length error immediately without retrying', async () => {
    const otherError = Object.assign(new Error('invalid model id'), {
      status: 404,
      errorType: 'not_found_error',
    });
    callOnce.mockRejectedValueOnce(otherError);

    await expect(
      runChat({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'm',
        messages: bigConversation(),
        toolPermissions: {},
      }),
    ).rejects.toBe(otherError);

    expect(callOnce).toHaveBeenCalledTimes(1);
  });
});

describe('runOneTool tab_id injection (boundTabId fallback)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const installChromeMock = () => {
    const sendMessage = vi.fn((_msg: { type: string; name: string; params: Record<string, unknown> }) =>
      Promise.resolve({ ok: true, result: 'done' }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    return sendMessage;
  };

  const run = async (tabIdArg: unknown) => {
    const sendMessage = installChromeMock();
    const conversation: CanonicalMessage[] = [];
    const appended: CanonicalMessage[] = [];
    await _internal.runOneTool(
      { id: 't1', name: 'get_page_content', args: { tab_id: tabIdArg } },
      conversation,
      appended,
      undefined,
      'chrome:abc:99',
    );
    return sendMessage.mock.calls[0][0].params.tab_id;
  };

  it('injects boundTabId when tab_id is undefined', async () => {
    expect(await run(undefined)).toBe('chrome:abc:99');
  });

  it('injects boundTabId when tab_id is 0 (a hallucinated invalid id, never a real Chrome tab id)', async () => {
    expect(await run(0)).toBe('chrome:abc:99');
  });

  it('injects boundTabId when tab_id is negative', async () => {
    expect(await run(-5)).toBe('chrome:abc:99');
  });

  it('injects boundTabId when tab_id is NaN', async () => {
    expect(await run(NaN)).toBe('chrome:abc:99');
  });

  it('injects boundTabId when tab_id is Infinity', async () => {
    expect(await run(Infinity)).toBe('chrome:abc:99');
  });

  it('does NOT override an explicit, genuinely valid positive tab_id', async () => {
    expect(await run(42)).toBe(42);
  });

  it('does NOT inject boundTabId for list_tabs (global query)', async () => {
    const sendMessage = installChromeMock();
    const conversation: CanonicalMessage[] = [];
    const appended: CanonicalMessage[] = [];
    await _internal.runOneTool(
      { id: 't1', name: 'list_tabs', args: {} },
      conversation,
      appended,
      undefined,
      'chrome:abc:99',
    );
    expect(sendMessage.mock.calls[0][0].params.tab_id).toBeUndefined();
  });
});
