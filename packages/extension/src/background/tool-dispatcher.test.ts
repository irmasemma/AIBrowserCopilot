import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy / side-effectful imports that tool-dispatcher pulls in so the
// module loads cleanly in a node test env.
vi.mock('../shared/logger.js', () => ({ logRecord: vi.fn(), logError: vi.fn() }));
vi.mock('./playwright-bridge.js', () => ({ withPlaywrightPage: vi.fn() }));

import { withTimeout, dispatchTool, TOOL_DISPATCH_TIMEOUT_MS, capToolResult, TOOL_RESULT_MAX_CHARS } from './tool-dispatcher.js';
import { withPlaywrightPage } from './playwright-bridge.js';

const never = <T>() => new Promise<T>(() => { /* never settles */ });

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('passes a fast rejection through unchanged', async () => {
    const err = Object.assign(new Error('boom'), { code: 'SOME_CODE' });
    await expect(withTimeout(Promise.reject(err), 1000, 'x')).rejects.toBe(err);
  });

  it('rejects with code TOOL_TIMEOUT when the promise hangs past the deadline', async () => {
    await expect(withTimeout(never(), 20, 'take_screenshot'))
      .rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });
  });

  it('the timeout error message names the tool', async () => {
    await expect(withTimeout(never(), 20, 'take_screenshot'))
      .rejects.toThrow(/take_screenshot/);
  });
});

describe('dispatchTool timeout enforcement', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ url: 'https://example.com' }]),
        get: vi.fn().mockResolvedValue({ id: 123, url: 'https://example.com', windowId: 1 }),
      },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), lastError: undefined },
    });
    // The capture path (withPlaywrightPage → CDP) HANGS — simulates a tool that
    // never settles. The dispatch timeout must still rescue it.
    vi.mocked(withPlaywrightPage).mockImplementation(() => never());
  });

  it('rejects a hanging tool with TOOL_TIMEOUT instead of hanging forever', async () => {
    await expect(
      dispatchTool('take_screenshot', { tab_id: 'chrome:abc:123' }, 60),
    ).rejects.toMatchObject({ code: 'TOOL_TIMEOUT' });
  });

  it('the default dispatch timeout sits under the bridge 30s tool-request timeout', () => {
    expect(TOOL_DISPATCH_TIMEOUT_MS).toBeLessThan(30_000);
  });
});

// ── Regression locks for the 2026-06-19 playwright-path fixes ────────────────
// These drive the REAL dispatcher logic (option passing, snapshot note, no
// post-click re-resolve) by mocking withPlaywrightPage to run the handler's
// callback against a controllable fake Page. Timing/hang behavior is covered
// by the live e2e (tool-path-real.spec.ts); these lock the deterministic logic.

/** A fake playwright Page + Locator whose ops are recorded and configurable. */
function makeFakePage(opts: { refLines?: string } = {}) {
  const calls: { screenshotOpts?: any; clickOpts?: any; pressOpts?: any; loadStates: string[]; locatorOps: string[]; evaluateHandleCount: number } = {
    loadStates: [], locatorOps: [], evaluateHandleCount: 0,
  };
  const locator: any = {
    nth: () => locator,
    scrollIntoViewIfNeeded: async () => { calls.locatorOps.push('scroll'); },
    evaluateHandle: async () => { calls.evaluateHandleCount++; calls.locatorOps.push('evaluateHandle'); return { jsonValue: async () => ({ tag: 'A', text: 'More', href: 'https://x' }) }; },
    click: async (o: any) => { calls.clickOpts = o; calls.locatorOps.push('click'); },
    press: async (_k: string, o: any) => { calls.pressOpts = o; calls.locatorOps.push('press'); },
  };
  const page: any = {
    locator: () => locator,
    getByText: () => locator,
    waitForLoadState: async (s: string) => { calls.loadStates.push(s); },
    evaluate: async () => opts.refLines ?? '',
    screenshot: async (o: any) => { calls.screenshotOpts = o; return new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]); },
  };
  return { page, calls };
}

function stubChrome() {
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 123, url: 'https://example.com' }]),
      get: vi.fn().mockResolvedValue({ id: 123, url: 'https://example.com', windowId: 1 }),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), lastError: undefined },
  });
}

function textOf(result: any): string {
  return (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
}

describe('take_screenshot disables the stability waits that made it slow', () => {
  beforeEach(() => { stubChrome(); vi.restoreAllMocks(); stubChrome(); });

  it('passes animations:disabled + caret:hide + a bounded timeout, and waits for load first', async () => {
    const { page, calls } = makeFakePage();
    vi.mocked(withPlaywrightPage).mockImplementation(async (_t: number, cb: any) => cb(page));

    const res: any = await dispatchTool('take_screenshot', { tab_id: 'chrome:abc:123', format: 'jpeg' }, 20_000);

    expect(calls.screenshotOpts).toMatchObject({ animations: 'disabled', caret: 'hide' });
    expect(calls.screenshotOpts.timeout).toBeGreaterThan(0);
    expect(calls.screenshotOpts.timeout).toBeLessThanOrEqual(20_000);
    expect(calls.loadStates).toContain('load'); // settles a just-navigated page before capture
    expect(res.content.some((c: any) => c.type === 'image')).toBe(true);
  });
});

describe('navigating-action snapshot is honest, never a silent empty, never a re-resolve', () => {
  beforeEach(() => { stubChrome(); vi.restoreAllMocks(); stubChrome(); });

  it('click_element returns success + real refs when the post-action snapshot has them', async () => {
    const { page } = makeFakePage({ refLines: 'e1: button "Submit"\ne2: link "More"' });
    vi.mocked(withPlaywrightPage).mockImplementation(async (_t: number, cb: any) => cb(page));

    const res: any = await dispatchTool('click_element', { tab_id: 'chrome:abc:123', selector: 'a' }, 20_000);
    const text = textOf(res);

    expect(text).toMatch(/"success":\s*true/);
    expect(text).toContain('Interactive elements');
    expect(text).toContain('e1: button');
  });

  it('click_element returns an explicit "still loading" note (NOT a silent empty) when refs are absent', async () => {
    const { page } = makeFakePage({ refLines: '' }); // destination still loading → no refs
    vi.mocked(withPlaywrightPage).mockImplementation(async (_t: number, cb: any) => cb(page));

    const res: any = await dispatchTool('click_element', { tab_id: 'chrome:abc:123', selector: 'a' }, 20_000);
    const text = textOf(res);

    expect(text).toMatch(/"success":\s*true/);
    expect(text).toMatch(/still loading/i);
    expect(text).not.toContain('Interactive elements');
  });

  it('click_element NEVER re-resolves the element after clicking (the hang/false-timeout class)', async () => {
    // One fake page is reused for the click op and the snapshot capture. The
    // element info is read ONCE before the click; nothing after it. The post-nav
    // re-resolve that hung ~16-18s and reported landed clicks as failures is gone.
    const { page, calls } = makeFakePage({ refLines: 'e1: link "More"' });
    vi.mocked(withPlaywrightPage).mockImplementation(async (_t: number, cb: any) => cb(page));

    await dispatchTool('click_element', { tab_id: 'chrome:abc:123', selector: 'a' }, 20_000);

    expect(calls.locatorOps.indexOf('click')).toBeGreaterThanOrEqual(0);
    // No locator op (evaluateHandle/scroll/etc.) appears AFTER the click.
    const afterClick = calls.locatorOps.slice(calls.locatorOps.indexOf('click') + 1);
    expect(afterClick).toHaveLength(0);
    expect(calls.evaluateHandleCount).toBe(1); // read once, before the click
    expect(calls.clickOpts.timeout).toBeGreaterThan(0); // bounded click
  });

  it('press_key is bounded + noWaitAfter so a navigating keypress cannot hang (same class as click)', async () => {
    const { page, calls } = makeFakePage({ refLines: 'e1: textbox' });
    vi.mocked(withPlaywrightPage).mockImplementation(async (_t: number, cb: any) => cb(page));

    const res: any = await dispatchTool('press_key', { tab_id: 'chrome:abc:123', selector: 'input', key: 'Enter' }, 20_000);

    expect(textOf(res)).toMatch(/"success":\s*true/);
    expect(calls.pressOpts.timeout).toBeGreaterThan(0);
    expect(calls.pressOpts.noWaitAfter).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Size choke point (AD-40 / Threads infinite-scroll incident). A real session
// had get_page_content return 403,154 chars in one tool result, which alone
// blew the MCP client's 200k-token context window and killed the session.
// `capToolResult` is the single choke point (mirrors `withTimeout`'s role for
// the time invariant) that dispatchTool applies to every handler's output.
// ─────────────────────────────────────────────────────────────────────────

describe('capToolResult — the size choke point', () => {
  it('the cap sits in the 50k-100k char range specified by the task', () => {
    expect(TOOL_RESULT_MAX_CHARS).toBeGreaterThanOrEqual(50_000);
    expect(TOOL_RESULT_MAX_CHARS).toBeLessThanOrEqual(100_000);
  });

  it('a payload strictly under the cap passes through byte-identical — no marker, no mutation', () => {
    const text = 'x'.repeat(TOOL_RESULT_MAX_CHARS - 1);
    const input = { content: [{ type: 'text', text }] };
    const out = capToolResult(input) as typeof input;
    expect(out.content[0].text).toBe(text);
    expect(out.content[0].text).not.toContain('TRUNCATED');
  });

  it('a payload exactly at the cap is NOT truncated (documented boundary: <=, not <)', () => {
    const text = 'x'.repeat(TOOL_RESULT_MAX_CHARS);
    const input = { content: [{ type: 'text', text }] };
    const out = capToolResult(input) as typeof input;
    expect(out.content[0].text).toBe(text);
    expect(out.content[0].text.length).toBe(TOOL_RESULT_MAX_CHARS);
    expect(out.content[0].text).not.toContain('TRUNCATED');
  });

  it('a payload over the cap is truncated WITH a marker stating the ORIGINAL size', () => {
    const originalSize = TOOL_RESULT_MAX_CHARS + 12_345;
    const text = 'x'.repeat(originalSize);
    const input = { content: [{ type: 'text', text }] };
    const out = capToolResult(input) as typeof input;

    expect(out.content[0].text.startsWith('x'.repeat(TOOL_RESULT_MAX_CHARS))).toBe(true);
    expect(out.content[0].text).toContain(`TRUNCATED: content was ${originalSize} chars, showing first ${TOOL_RESULT_MAX_CHARS}`);
    // The kept portion (before the marker) is exactly the cap length.
    const markerIndex = out.content[0].text.indexOf('\n\n[TRUNCATED');
    expect(markerIndex).toBe(TOOL_RESULT_MAX_CHARS);
  });

  it('the marker is tool-agnostic — actionable for tools with AND without pagination', () => {
    // capToolResult is the generic backstop applied to every tool's output,
    // not just get_page_content's — so its marker must not claim an `offset`
    // param that most tools (snapshot, extract_data, ...) don't have.
    const text = 'x'.repeat(TOOL_RESULT_MAX_CHARS + 1);
    const out = capToolResult({ content: [{ type: 'text', text }] }) as { content: Array<{ text: string }> };
    expect(out.content[0].text).toMatch(/pagination/i);
    expect(out.content[0].text).toMatch(/narrow/i);
  });

  it('caps multiple text fields in the content array independently', () => {
    const short = 'short text';
    const long = 'y'.repeat(TOOL_RESULT_MAX_CHARS + 500);
    const input = { content: [{ type: 'text', text: short }, { type: 'text', text: long }] };
    const out = capToolResult(input) as typeof input;
    expect(out.content[0].text).toBe(short);
    expect(out.content[1].text.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS); // marker adds length
    expect(out.content[1].text).toContain('TRUNCATED');
  });

  it('leaves non-text content items (e.g. images) untouched', () => {
    const input = { content: [{ type: 'image', data: 'base64stuff', mimeType: 'image/png' }] };
    const out = capToolResult(input) as typeof input;
    expect(out.content[0]).toEqual(input.content[0]);
  });

  it('passes through non-object / content-less results unchanged (defensive)', () => {
    expect(capToolResult(null)).toBeNull();
    expect(capToolResult(undefined)).toBeUndefined();
    expect(capToolResult('a string')).toBe('a string');
    expect(capToolResult({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('accepts a custom cap (used for boundary tests without depending on the real constant)', () => {
    const out = capToolResult({ content: [{ type: 'text', text: '0123456789' }] }, 5) as { content: Array<{ text: string }> };
    expect(out.content[0].text.startsWith('01234')).toBe(true);
    expect(out.content[0].text).toContain('content was 10 chars, showing first 5');
  });
});

describe('dispatchTool applies the size cap end-to-end (get_page_content)', () => {
  function stubChromeWithScripting(executeScriptResults: unknown[]) {
    const executeScript = vi.fn();
    for (const r of executeScriptResults) {
      executeScript.mockResolvedValueOnce([{ result: r }]);
    }
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 123, url: 'https://example.com' }]),
        get: vi.fn().mockResolvedValue({ id: 123, url: 'https://example.com', windowId: 1 }),
      },
      scripting: { executeScript },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), lastError: undefined },
    });
    return executeScript;
  }

  it('a huge accumulated page (the Threads infinite-scroll shape) never returns unbounded text', async () => {
    const hugePage = 'p'.repeat(TOOL_RESULT_MAX_CHARS * 5); // ~5x the cap
    stubChromeWithScripting([
      hugePage, // content read
      '\n\n--- Scroll Position ---\nViewing: 0-800 of 900000px (0%)\nMore content below: yes', // scrollInfo
    ]);

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123' }, 20_000);
    const text = res.content[0].text as string;

    // Bounded by get_page_content's OWN effective window (which reserves
    // headroom for scrollInfo + its accurate pagination marker) — never by
    // the outer generic backstop marker, which would report the CAP value as
    // the continuation offset instead of the true page-relative position.
    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(text).not.toContain('TRUNCATED');
    expect(text).toContain('call again with offset=');
  });

  it('never triggers the outer capToolResult backstop for a well-formed oversized page (offset > 0, remaining still large)', async () => {
    // The load-bearing inverse-case assertion: a huge page read from a
    // mid-page offset must get get_page_content's OWN accurate marker,
    // reporting the TRUE page-relative continuation offset — never the
    // generic/wrong marker capToolResult would otherwise append (which would
    // report the CAP value, 80000, as if it were the continuation point —
    // sending the model backwards to the start of the page instead of
    // forwards).
    const total = 600_000; // well over 500,000 chars
    const hugePage = 'p'.repeat(total);
    stubChromeWithScripting([
      hugePage,
      '\n\n--- Scroll Position ---\nViewing: 0-800 of 900000px (0%)\nMore content below: yes',
    ]);

    const offset = 200_000;
    const RESERVE = 1000; // mirrors RESULT_OVERHEAD_RESERVE in tool-dispatcher.ts (not exported)
    const expectedWindowEnd = offset + (TOOL_RESULT_MAX_CHARS - RESERVE); // 279,000 — NOT 80,000

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123', offset }, 20_000);
    const text = res.content[0].text as string;

    expect(text).toContain(`call again with offset=${expectedWindowEnd}`);
    expect(text).not.toContain('TRUNCATED');
    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  });

  it('emits no "call again"/continuation language when the window ends exactly at the end of the page (remaining === 0)', async () => {
    const RESERVE = 1000;
    const effectiveMaxChars = TOOL_RESULT_MAX_CHARS - RESERVE; // 79,000
    const offset = 200_000;
    const total = offset + effectiveMaxChars; // window lands exactly on the end of the page
    const hugePage = 'p'.repeat(total);
    stubChromeWithScripting([
      hugePage,
      '\n\n--- Scroll Position ---\nViewing: 0-800 of 900000px (0%)\nMore content below: no',
    ]);

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123', offset }, 20_000);
    const text = res.content[0].text as string;

    expect(text).not.toContain('call again');
    expect(text).not.toContain('more chars available');
    expect(text).not.toContain('TRUNCATED');
  });

  it('clamps the effective window even when max_chars is explicitly passed at the cap value (not just the default)', async () => {
    // The clamp must be unconditional — a property of the interaction, not
    // just the default value — so an explicit caller-supplied max_chars at
    // (or above) the cap must ALSO be clamped down to leave headroom.
    const total = 600_000;
    const hugePage = 'p'.repeat(total);
    stubChromeWithScripting([
      hugePage,
      '\n\n--- Scroll Position ---\nViewing: 0-800 of 900000px (0%)\nMore content below: yes',
    ]);

    const res: any = await dispatchTool(
      'get_page_content',
      { tab_id: 'chrome:abc:123', offset: 100_000, max_chars: TOOL_RESULT_MAX_CHARS },
      20_000,
    );
    const text = res.content[0].text as string;

    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(text).not.toContain('TRUNCATED');
  });

  it('offset/max_chars window the text correctly', async () => {
    const digits = Array.from({ length: 1000 }, (_, i) => String(i % 10)).join(''); // 1000 known chars
    stubChromeWithScripting([
      digits,
      '\n\n--- Scroll Position ---\nViewing: 0-0 of 0px (0%)\nMore content below: no',
    ]);

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123', offset: 100, max_chars: 200 }, 20_000);
    const text = res.content[0].text as string;

    expect(text.startsWith(digits.slice(100, 300))).toBe(true);
    expect(text).toContain('Showing chars 100-300 of 1000');
    expect(text).toContain('700 more chars available');
    expect(text).toContain('call again with offset=300');
  });

  it('requesting past the end of the content returns empty content and no "more chars" marker', async () => {
    const digits = '0123456789'; // 10 chars total
    stubChromeWithScripting([
      digits,
      '\n\n--- Scroll Position ---\nViewing: 0-0 of 0px (0%)\nMore content below: no',
    ]);

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123', offset: 500, max_chars: 200 }, 20_000);
    const text = res.content[0].text as string;

    expect(text).not.toContain('more chars available');
    expect(text).not.toContain('Showing chars');
    // Only the scroll-position suffix remains; no page-content slice, no pagination marker.
    expect(text.startsWith('\n\n--- Scroll Position ---')).toBe(true);
  });

  it('a page just under the cap with default pagination passes through without a pagination marker', async () => {
    const content = 'a'.repeat(1000); // small page, well under any cap
    stubChromeWithScripting([
      content,
      '\n\n--- Scroll Position ---\nViewing: 0-800 of 1000px (80%)\nMore content below: no',
    ]);

    const res: any = await dispatchTool('get_page_content', { tab_id: 'chrome:abc:123' }, 20_000);
    const text = res.content[0].text as string;

    expect(text).toContain(content);
    expect(text).not.toContain('more chars available');
    expect(text).not.toContain('TRUNCATED');
  });
});

describe('extract_data — improved "no structured data" error message', () => {
  it('guides the model toward snapshot / get_page_content instead of just saying "not detected"', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 123, url: 'https://example.com' }]),
        get: vi.fn().mockResolvedValue({ id: 123, url: 'https://example.com', windowId: 1 }),
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: { regions: [], bestRegion: null } }]),
      },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined), lastError: undefined },
    });

    await expect(dispatchTool('extract_data', { tab_id: 'chrome:abc:123' }, 20_000))
      .rejects.toMatchObject({
        code: 'CONTENT_UNAVAILABLE',
        message: expect.stringMatching(/snapshot/i),
      });
    await expect(dispatchTool('extract_data', { tab_id: 'chrome:abc:123' }, 20_000))
      .rejects.toMatchObject({ message: expect.stringMatching(/get_page_content/i) });
  });
});
