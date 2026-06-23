import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getBrowserInstanceId, __resetCacheForTesting } from './browser-instance-id';

let store: Record<string, unknown> = {};

const mockChromeStorage = () => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn((key: string, cb: (data: Record<string, unknown>) => void) => {
          cb(key in store ? { [key]: store[key] } : {});
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(store, items);
          cb?.();
        }),
      },
    },
  });
};

beforeEach(() => {
  __resetCacheForTesting();
  vi.unstubAllGlobals();
  // Stub navigator (jsdom has it, but we want deterministic UA).
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120.0' });
});

describe('getBrowserInstanceId', () => {
  it('returns composite ${brand}:${uuid} on first call and persists the uuid', async () => {
    mockChromeStorage();
    const id = await getBrowserInstanceId();
    expect(id).toMatch(/^chrome:[0-9a-f-]+$/i);

    const persistedUuid = store.browserInstanceUuid as string;
    expect(persistedUuid).toBeTruthy();
    expect(id.endsWith(persistedUuid)).toBe(true);
  });

  it('returns the same id on subsequent calls (cached in-process)', async () => {
    mockChromeStorage();
    const a = await getBrowserInstanceId();
    const b = await getBrowserInstanceId();
    expect(a).toBe(b);
  });

  it('reuses a previously stored uuid across cache resets', async () => {
    mockChromeStorage();
    const first = await getBrowserInstanceId();

    __resetCacheForTesting();
    const second = await getBrowserInstanceId();

    expect(first).toBe(second);
  });

  it('detects edge brand', async () => {
    mockChromeStorage();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120.0 Edg/120.0' });
    const id = await getBrowserInstanceId();
    expect(id.startsWith('edge:')).toBe(true);
  });

  it('falls back to brand-only when chrome.storage is unavailable', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120.0' });
    const id = await getBrowserInstanceId();
    expect(id).toBe('chrome');
  });

  it('two profiles with separate storage produce different ids', async () => {
    // Profile A
    mockChromeStorage();
    const profileA = await getBrowserInstanceId();

    // Simulate Profile B by resetting cache AND wiping storage
    __resetCacheForTesting();
    mockChromeStorage(); // fresh storage = fresh uuid

    const profileB = await getBrowserInstanceId();

    expect(profileA).not.toBe(profileB);
    expect(profileA.startsWith('chrome:')).toBe(true);
    expect(profileB.startsWith('chrome:')).toBe(true);
  });
});
