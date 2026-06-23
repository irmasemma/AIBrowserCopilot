/**
 * End-to-end coverage for TRUE multi-client routing: two real browser
 * profiles connected to ONE bridge at the same time, driven by a real MCP
 * client over WS.
 *
 * The sibling spec `multi-profile-fanout.spec.ts` validates the single-
 * browser pieces (namespacing, tab activation, SW keepalive, envelope
 * translation) but only ever launches ONE real browser — the "two profiles"
 * case there is simulated with a fake WS probe. This spec closes that gap by
 * launching TWO persistent Chromium contexts (separate user-data-dirs → two
 * distinct composite browserIds) and asserting the paths that only exist
 * when more than one browser is connected:
 *
 *   1. Bridge keys both extensions distinctly (server_info.connectedBrowsers).
 *   2. `list_tabs` fan-out aggregates tabs from BOTH browsers, each namespaced
 *      with its own composite browserId.
 *   3. A namespaced `tab_id` routes a non-fan-out tool to the OWNING browser
 *      (happy path — the tab is found there).
 *   4. Cross-browser isolation: the SAME rawId prefixed with the OTHER
 *      browser's id routes to that browser and returns TAB_NOT_FOUND, proving
 *      the prefix — not a global tab table — decides routing.
 *   5. Brand fan-out (`browser: "chrome"`) still includes every same-brand
 *      instance.
 *   6. Survivor fan-out: after one browser disconnects, the bridge drops it
 *      and `list_tabs` returns only the survivor's tabs.
 *
 * Everything runs against the real compiled bridge over WS — no mocks. The
 * routing assertions are permission-free (they rely on TAB_NOT_FOUND
 * semantics, not page content), so they don't depend on <all_urls> being
 * granted to the unpacked extension.
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');
const nativeHostDist = path.resolve(__dirname, '../../packages/native-host/dist/index.js');
const testPagePath = path.resolve(__dirname, 'fixtures/test-page.html');

interface Client {
  label: string;
  context: BrowserContext;
  extensionId: string;
  uuid: string;
  browserId: string; // composite "chrome:<uuid>"
}

let bridge: ChildProcess;
let bridgePort: number;
const clients: Client[] = [];

const tmpDataDir = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `copilot-mc-${label}-`));

const launchContext = (userDataDir: string): Promise<BrowserContext> =>
  chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

const findExtensionId = async (ctx: BrowserContext): Promise<string> => {
  await new Promise((r) => setTimeout(r, 2500));
  const sws = ctx.serviceWorkers();
  if (sws.length > 0) return sws[0].url().split('/')[2];
  try {
    const sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 });
    return sw.url().split('/')[2];
  } catch {
    const ext = ctx.pages().find((p) => p.url().startsWith('chrome-extension://'));
    if (ext) return ext.url().split('/')[2];
    throw new Error('extension id not found');
  }
};

/** Wait for the extension to report a live bridge connection, return its uuid. */
const waitForConnectedAndUuid = async (
  ctx: BrowserContext,
  extId: string,
  timeoutMs = 20_000,
): Promise<string> => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const snap = await page.evaluate(async () => {
        const data = await chrome.storage.local.get(['connectionContext', 'browserInstanceUuid']);
        return {
          state: (data.connectionContext as { state?: string } | undefined)?.state,
          uuid: data.browserInstanceUuid as string | undefined,
        };
      });
      if (snap.state === 'connected' && snap.uuid) return snap.uuid;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`extension ${extId} did not connect within ${timeoutMs}ms`);
  } finally {
    await page.close();
  }
};

/** One-shot read of the bridge's server_info via a throwaway probe socket. */
const getServerInfo = async (port: number): Promise<{ connectedBrowsers: string[] }> => {
  const probeId = `chrome:mc-probe-${clients.length}-${process.pid}`;
  const probe = new WebSocket(`ws://127.0.0.1:${port}?browserId=${encodeURIComponent(probeId)}`);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server_info timeout')), 5000);
      probe.onmessage = (e) => {
        const msg = JSON.parse(e.data.toString());
        if (msg.type === 'server_info') {
          clearTimeout(timer);
          // Exclude our own probe id from the reported set.
          const browsers = (msg.connectedBrowsers as string[]).filter((b) => b !== probeId);
          resolve({ connectedBrowsers: browsers });
        }
      };
      probe.onerror = () => { clearTimeout(timer); reject(new Error('probe WS failed')); };
    });
  } finally {
    try { probe.close(); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** Run one JSON-RPC turn against the bridge as an MCP client (?role=mcp). */
const callMcp = async (
  port: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<{
  id: number;
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
}> => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
  const reqId = Math.floor((bridgePort * 7919 + clients.length * 31 + method.length) % 1_000_000) + 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params })));
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== reqId) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      resolve(msg);
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
};

interface TabEntry { id: string; url?: string; title?: string }

/** Call list_tabs over MCP and return the merged `tabs` array. */
const listTabsViaMcp = async (port: number, browser?: string): Promise<TabEntry[]> => {
  const resp = await callMcp(port, 'tools/call', {
    name: 'list_tabs',
    arguments: browser ? { browser } : {},
  });
  expect(resp.error, `list_tabs JSON-RPC error: ${JSON.stringify(resp.error)}`).toBeUndefined();
  const text = resp.result?.content?.[0]?.text ?? '';
  const payload = JSON.parse(text) as { tabs?: TabEntry[] };
  return payload.tabs ?? [];
};

/** browserId prefix of a namespaced tab id: "chrome:<uuid>:123" → "chrome:<uuid>". */
const prefixOf = (tabId: string): string => tabId.slice(0, tabId.lastIndexOf(':'));
const rawOf = (tabId: string): string => tabId.slice(tabId.lastIndexOf(':') + 1);

test.describe('multi-client routing — two real browsers, one bridge', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);

    // 0. Evict any autostart-managed bridge so our freshly-built node bridge
    //    wins port 7483. Autostart relaunches the binary afterwards (old code,
    //    fine for production — we only need the current code under test).
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM agenthub-win-x64.exe', { stdio: 'ignore' }); } catch { /* not running */ }
    } else {
      try { execSync('pkill -f agenthub', { stdio: 'ignore' }); } catch { /* not running */ }
    }
    await new Promise((r) => setTimeout(r, 500));

    // 1. Spawn the bridge with a fresh, empty LOCALAPPDATA so it can't find an
    //    extension-id allowlist and falls back to "accept any chrome-extension
    //    origin" — the unpacked extension's path-derived id is unpredictable.
    const installParent = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-mc-install-'));
    const lockFile = path.join(installParent, 'agenthub', 'server.lock');
    fs.mkdirSync(path.join(installParent, 'agenthub'), { recursive: true });
    bridge = spawn('node', [nativeHostDist], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '1', LOCALAPPDATA: installParent, AGENTHUB_INSTALL_DIR: path.join(installParent, 'agenthub') },
    });
    let bridgeExited: number | null = null;
    bridge.on('exit', (code) => { bridgeExited = code ?? -1; });

    // Readiness signal: startServer writes %LOCALAPPDATA%/agenthub/server.lock
    // ONLY from its 'listening' handler — i.e. only once it actually owns the
    // port. (It never prints a "Server started" line; the lock file is the
    // real signal.) Crucially, if port 7483 was already held, index.js flips
    // into client-proxy mode and never writes a lock — so a missing lock here
    // means we failed to commandeer the port, not just a slow start.
    bridgePort = await new Promise<number>((resolve, reject) => {
      const deadline = Date.now() + 15_000;
      const poll = () => {
        if (bridgeExited !== null) return reject(new Error(`bridge exited: ${bridgeExited}`));
        try {
          const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { port?: number; pid?: number };
          if (lock.port && lock.pid === bridge.pid) return resolve(lock.port);
        } catch { /* not written yet */ }
        if (Date.now() > deadline) {
          return reject(new Error(
            'bridge never claimed port 7483 (no lock file). Another bridge (your live ' +
            'autostart instance) is holding the port — run with that bridge stopped.',
          ));
        }
        setTimeout(poll, 250);
      };
      poll();
    });

    // 2. Launch two browser profiles and wait for both to connect. They share
    //    the same path-derived extensionId but get distinct browserInstanceUuids
    //    (separate user-data-dirs) → distinct composite browserIds.
    for (const label of ['A', 'B']) {
      const context = await launchContext(tmpDataDir(label));
      const extensionId = await findExtensionId(context);
      const uuid = await waitForConnectedAndUuid(context, extensionId);
      clients.push({ label, context, extensionId, uuid, browserId: `chrome:${uuid}` });
    }

    // Both must have produced different uuids, or the rest is meaningless.
    expect(clients[0].uuid).not.toBe(clients[1].uuid);
  });

  test.afterAll(async () => {
    for (const c of clients) { try { await c.context.close(); } catch { /* noop */ } }
    if (bridge && !bridge.killed) {
      bridge.kill();
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test('bridge keys both browsers distinctly in server_info', async () => {
    const info = await getServerInfo(bridgePort);
    for (const c of clients) {
      expect(
        info.connectedBrowsers,
        `expected ${c.label}'s browserId ${c.browserId} in connectedBrowsers=${JSON.stringify(info.connectedBrowsers)}`,
      ).toContain(c.browserId);
    }
    // Both are the chrome brand but must be two distinct composite ids.
    const chromeIds = info.connectedBrowsers.filter((b) => b.startsWith('chrome:'));
    expect(new Set(chromeIds).size).toBeGreaterThanOrEqual(2);
  });

  test('list_tabs fan-out aggregates tabs from BOTH browsers, each namespaced to its owner', async () => {
    // Give each browser a uniquely-identifiable tab so we can tie a tab back
    // to the profile that owns it.
    const pageA = await clients[0].context.newPage();
    await pageA.goto(`file://${testPagePath}?owner=A`);
    const pageB = await clients[1].context.newPage();
    await pageB.goto(`file://${testPagePath}?owner=B`);
    await new Promise((r) => setTimeout(r, 800));

    try {
      const tabs = await listTabsViaMcp(bridgePort);
      expect(tabs.length, 'fan-out should return tabs from both profiles').toBeGreaterThan(0);

      // Every namespaced id must be well-formed.
      for (const t of tabs) expect(t.id, `tab id ${t.id} not namespaced`).toMatch(/^chrome:.+:\d+$/);

      // Both composite browserIds must appear among the tab prefixes.
      const prefixes = new Set(tabs.map((t) => prefixOf(t.id)));
      expect(prefixes, `prefixes=${[...prefixes]}`).toContain(clients[0].browserId);
      expect(prefixes).toContain(clients[1].browserId);

      // The owner=A page must be namespaced to A; owner=B to B.
      const ownerA = tabs.find((t) => t.url?.includes('owner=A'));
      const ownerB = tabs.find((t) => t.url?.includes('owner=B'));
      expect(ownerA, 'owner=A tab should be present').toBeTruthy();
      expect(ownerB, 'owner=B tab should be present').toBeTruthy();
      expect(prefixOf(ownerA!.id)).toBe(clients[0].browserId);
      expect(prefixOf(ownerB!.id)).toBe(clients[1].browserId);
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('a namespaced tab_id routes a non-fan-out tool to the OWNING browser (happy path)', async () => {
    const pageA = await clients[0].context.newPage();
    await pageA.goto(`file://${testPagePath}?probe=happy`);
    await new Promise((r) => setTimeout(r, 600));

    try {
      const tabs = await listTabsViaMcp(bridgePort);
      const aTab = tabs.find((t) => t.url?.includes('probe=happy'));
      expect(aTab, 'probe tab should be listed').toBeTruthy();
      expect(prefixOf(aTab!.id)).toBe(clients[0].browserId);

      // Route get_page_content with A's namespaced id. The bridge sends it to
      // A; A's getTab(rawId) finds the tab. Permissions may block the read,
      // but the result must NOT be TAB_NOT_FOUND — that would mean it routed
      // to the wrong (or no) browser.
      const resp = await callMcp(bridgePort, 'tools/call', {
        name: 'get_page_content',
        arguments: { tab_id: aTab!.id, format: 'text' },
      });
      expect(resp.error).toBeUndefined();
      const text = resp.result?.content?.[0]?.text ?? '';
      expect(
        /tab_not_found/i.test(text),
        `tab existed in the owning browser, expected no TAB_NOT_FOUND but got: ${text.slice(0, 200)}`,
      ).toBe(false);
    } finally {
      await pageA.close();
    }
  });

  test('cross-browser isolation: same rawId under the OTHER browser routes there and 404s', async () => {
    // Open distinct pages in both so each has its own rawId space populated.
    const pageA = await clients[0].context.newPage();
    await pageA.goto(`file://${testPagePath}?iso=A`);
    const pageB = await clients[1].context.newPage();
    await pageB.goto(`file://${testPagePath}?iso=B`);
    await new Promise((r) => setTimeout(r, 800));

    try {
      const tabs = await listTabsViaMcp(bridgePort);
      const aRaws = new Set(tabs.filter((t) => prefixOf(t.id) === clients[0].browserId).map((t) => rawOf(t.id)));
      const bRaws = new Set(tabs.filter((t) => prefixOf(t.id) === clients[1].browserId).map((t) => rawOf(t.id)));
      expect(aRaws.size, 'browser A should own at least one tab').toBeGreaterThan(0);

      // Pick a rawId that exists in A but NOT in B (two independent profiles
      // can coincidentally share numeric tab ids — exclude any overlap).
      const aOnlyRaw = [...aRaws].find((r) => !bRaws.has(r));
      expect(aOnlyRaw, `no A-exclusive rawId found (A=${[...aRaws]} B=${[...bRaws]})`).toBeTruthy();

      // Control: correct prefix → routes to A → tab found (not TAB_NOT_FOUND).
      const correct = await callMcp(bridgePort, 'tools/call', {
        name: 'get_page_content',
        arguments: { tab_id: `${clients[0].browserId}:${aOnlyRaw}`, format: 'text' },
      });
      const correctText = correct.result?.content?.[0]?.text ?? '';
      expect(
        /tab_not_found/i.test(correctText),
        `control: A's own tab should be found, got: ${correctText.slice(0, 160)}`,
      ).toBe(false);

      // Isolation: same rawId but B's prefix → routes to B → B has no such tab
      // → TAB_NOT_FOUND. This is the proof that the PREFIX decides routing,
      // not a shared/global tab table.
      const crossed = await callMcp(bridgePort, 'tools/call', {
        name: 'get_page_content',
        arguments: { tab_id: `${clients[1].browserId}:${aOnlyRaw}`, format: 'text' },
      });
      expect(crossed.error).toBeUndefined();
      expect(crossed.result?.isError, 'cross-browser lookup must be a tool error').toBe(true);
      const crossedText = crossed.result?.content?.[0]?.text ?? '';
      expect(
        /tab_not_found|not found|may have been closed/i.test(crossedText),
        `expected TAB_NOT_FOUND from the other browser, got: ${crossedText.slice(0, 200)}`,
      ).toBe(true);
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('brand fan-out (browser: "chrome") still includes every same-brand instance', async () => {
    const pageA = await clients[0].context.newPage();
    await pageA.goto(`file://${testPagePath}?brand=A`);
    const pageB = await clients[1].context.newPage();
    await pageB.goto(`file://${testPagePath}?brand=B`);
    await new Promise((r) => setTimeout(r, 800));

    try {
      const tabs = await listTabsViaMcp(bridgePort, 'chrome');
      const prefixes = new Set(tabs.map((t) => prefixOf(t.id)));
      expect(prefixes).toContain(clients[0].browserId);
      expect(prefixes).toContain(clients[1].browserId);
    } finally {
      await pageA.close();
      await pageB.close();
    }
  });

  test('survivor fan-out: after one browser disconnects, only the survivor is routed', async () => {
    // Close browser B and let the bridge notice the socket drop.
    const survivor = clients[0];
    const leaving = clients[1];
    await leaving.context.close();
    clients.splice(1, 1); // keep afterAll from double-closing

    // Wait for the bridge to drop B from connectedBrowsers (allow for the
    // SW_RECONNECT grace handling on the bridge side).
    let info = await getServerInfo(bridgePort);
    const deadline = Date.now() + 15_000;
    while (info.connectedBrowsers.includes(leaving.browserId) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      info = await getServerInfo(bridgePort);
    }
    expect(info.connectedBrowsers, 'B should be gone').not.toContain(leaving.browserId);
    expect(info.connectedBrowsers, 'A should remain').toContain(survivor.browserId);

    // list_tabs must now only carry the survivor's tabs.
    const pageA = await survivor.context.newPage();
    await pageA.goto(`file://${testPagePath}?survivor=A`);
    await new Promise((r) => setTimeout(r, 600));
    try {
      const tabs = await listTabsViaMcp(bridgePort);
      const prefixes = new Set(tabs.map((t) => prefixOf(t.id)));
      expect(prefixes).toContain(survivor.browserId);
      expect(prefixes, 'no tabs should come from the disconnected browser').not.toContain(leaving.browserId);
    } finally {
      await pageA.close();
    }
  });
});
