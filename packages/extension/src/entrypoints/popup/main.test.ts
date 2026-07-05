// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The popup script (`main.ts`) runs its side effects at import time: it builds
// the DOM and wires up chrome.storage listeners. We mock `chrome` and provide
// an #app root, then dynamic-import the module fresh per test.
function installChromeMock() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (_keys: unknown, cb: (d: Record<string, unknown>) => void) => cb({}),
      },
      onChanged: { addListener: vi.fn() },
    },
    sidePanel: { open: vi.fn() },
    windows: { WINDOW_ID_CURRENT: -2 },
  };
}

describe('popup — connection status is hidden (not removed)', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    installChromeMock();
  });

  it('renders only the "Open Side Panel" button, with no connection-status indicator', async () => {
    await import('./main');
    const app = document.getElementById('app')!;

    // The action button is still present…
    const btn = app.querySelector('button');
    expect(btn?.textContent).toBe('Open Side Panel');

    // …but the status row (dot + label) is NOT appended while the feature flag
    // is off, so the popup shows no connection status text.
    expect(app.children).toHaveLength(1);
    expect(app.textContent).not.toContain('Checking');
    expect(app.textContent).not.toContain('Connected');
    expect(app.textContent).not.toContain('Not Connected');
  });
});
