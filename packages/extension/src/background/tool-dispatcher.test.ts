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
