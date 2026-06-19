import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy / side-effectful imports that tool-dispatcher pulls in so the
// module loads cleanly in a node test env.
vi.mock('../shared/logger.js', () => ({ logRecord: vi.fn(), logError: vi.fn() }));
vi.mock('./playwright-bridge.js', () => ({ withPlaywrightPage: vi.fn() }));

import { withTimeout, dispatchTool, TOOL_DISPATCH_TIMEOUT_MS } from './tool-dispatcher.js';
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
