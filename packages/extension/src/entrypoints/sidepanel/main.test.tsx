// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ConnectionContext } from '../../shared/types';

// ---------------------------------------------------------------------------
// Minimal chrome mock. The App tree mounts every panel (Chat/Tools/MCP/Settings)
// plus the relocated ConnectionHeader / SetupWizard, so we stub the whole
// surface those components touch. `storage.local` is backed by `store` so a test
// can seed `setupComplete`. `permissions.contains` is controllable so the
// SiteAccessBanner test can force the "blocked" branch.
// ---------------------------------------------------------------------------
let store: Record<string, unknown> = {};
let permissionsGranted = true;

function installChromeMock() {
  const listeners = { added: new Set<() => void>(), removed: new Set<() => void>() };
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension-id',
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      })),
      sendMessage: vi.fn(() => Promise.resolve()),
      reload: vi.fn(),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn((keys: unknown, cb?: (d: Record<string, unknown>) => void) => {
          const pick = (k: string) => (k in store ? { [k]: store[k] } : {});
          let result: Record<string, unknown> = {};
          if (typeof keys === 'string') result = pick(keys);
          else if (Array.isArray(keys)) result = keys.reduce((a, k) => ({ ...a, ...pick(k) }), {});
          else result = { ...store };
          if (cb) { cb(result); return undefined; }
          return Promise.resolve(result);
        }),
        set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(store, items);
          if (cb) { cb(); return undefined; }
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn(() => Promise.resolve(permissionsGranted)),
      request: vi.fn(() => Promise.resolve(permissionsGranted)),
      onAdded: { addListener: (f: () => void) => listeners.added.add(f), removeListener: (f: () => void) => listeners.added.delete(f) },
      onRemoved: { addListener: (f: () => void) => listeners.removed.add(f), removeListener: (f: () => void) => listeners.removed.delete(f) },
    },
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
    },
  });
}

// Import AFTER the module graph can see a real `document` (jsdom env). The store
// is imported so tests can seed connectionContext before render.
import { App } from './main';
import { useStore } from '../../sidepanel/store';

const BASE_CTX: ConnectionContext = {
  state: 'disconnected',
  failureCount: 0,
  missedHeartbeats: 0,
  lastConnectedAt: null,
  serverInfo: null,
  error: null,
  reconnectsThisSession: 0,
  diagnosticReason: null,
  lastVerifiedAt: 0,
  versionStatus: null,
};

let container: HTMLDivElement;

async function flush() {
  // Let queued microtasks (storage/permission promises) and preact effects settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  store = {};
  permissionsGranted = true;
  installChromeMock();
  useStore.getState().setConnectionContext({ ...BASE_CTX });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { render(null, container); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('App shell — MCP relocation', () => {
  // Chat tab is hidden from the tab strip for this release (CWS release —
  // known bug in chat-tab.tsx) and MCP is now the default/first tab, so
  // these two cases land directly on the (now-active, non-hidden) MCP panel
  // instead of Chat. See entrypoints/sidepanel/main.tsx TabStrip/activeTab.
  it('brand-new state: lands on MCP, which hosts the SetupWizard, no top-level ConnectionHeader', async () => {
    // helper_unavailable + setupComplete:false → needsSetup === true.
    store.setupComplete = undefined;
    useStore.getState().setConnectionContext({
      ...BASE_CTX,
      state: 'disconnected',
      diagnosticReason: 'helper_unavailable',
      lastConnectedAt: null,
    });

    await act(async () => { render(<App />, container); });
    await flush();

    // Active tab is MCP.
    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('MCP');

    // The MCP panel exists, is active (not hidden), and hosts the SetupWizard.
    const mcpPanel = container.querySelector<HTMLElement>('[data-testid="mcp-panel"]');
    expect(mcpPanel).not.toBeNull();
    expect(mcpPanel!.className).not.toContain('hidden');
    expect(mcpPanel!.textContent).toContain('Welcome to AgentHub'); // SetupWizard heading

    // needsSetup content mode shows the wizard, NOT the ConnectionHeader.
    expect(mcpPanel!.querySelector('[data-testid="connection-header"]')).toBeNull();

    // There is NO ConnectionHeader anywhere at the top level (above the tablist).
    const tablist = container.querySelector('[role="tablist"]')!;
    for (const h of container.querySelectorAll('[data-testid="connection-header"]')) {
      expect(tablist.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // (redundant, explicit): no header rendered at all in wizard mode.
    expect(container.querySelector('[data-testid="connection-header"]')).toBeNull();
  });

  it('engaged state: the ConnectionHeader renders INSIDE the (active) MCP panel, never above the tablist', async () => {
    // setupComplete:true → needsSetup === false → McpTab renders live status.
    store.setupComplete = true;
    useStore.getState().setConnectionContext({
      ...BASE_CTX,
      state: 'disconnected',
      diagnosticReason: 'no_lock_file',
      lastConnectedAt: 1_000,
    });

    await act(async () => { render(<App />, container); });
    await flush();

    // MCP is the default landing tab.
    const selected = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('MCP');

    const mcpPanel = container.querySelector<HTMLElement>('[data-testid="mcp-panel"]');
    expect(mcpPanel).not.toBeNull();
    expect(mcpPanel!.className).not.toContain('hidden'); // MCP active → not hidden

    // The relocated ConnectionHeader is present and lives inside the MCP panel.
    const header = container.querySelector('[data-testid="connection-header"]');
    expect(header).not.toBeNull();
    expect(header!.closest('[data-testid="mcp-panel"]')).toBe(mcpPanel);

    // ...and it is positioned AFTER the tablist in the DOM, i.e. not at top level.
    const tablist = container.querySelector('[role="tablist"]')!;
    expect(tablist.compareDocumentPosition(header!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('SiteAccessBanner stays global across every tab', () => {
  it('is present regardless of which tab is active', async () => {
    permissionsGranted = false; // force the blocked branch → banner shows
    store.setupComplete = true;
    useStore.getState().setConnectionContext({ ...BASE_CTX });

    await act(async () => { render(<App />, container); });
    await flush();

    const banner = () => container.querySelector('[data-testid="site-access-banner"]');
    const tablist = container.querySelector('[role="tablist"]')!;

    // Banner is above the tablist (global position).
    expect(banner()).not.toBeNull();
    expect(tablist.compareDocumentPosition(banner()!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

    // Switch through every tab; the banner must remain present each time.
    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const labels = tabButtons.map((b) => b.textContent);
    expect(labels?.join(' ')).toContain('MCP'); // sanity: the new tab exists

    for (const btn of tabButtons) {
      await act(async () => { btn.click(); });
      await flush();
      expect(banner()).not.toBeNull();
    }
  });
});
