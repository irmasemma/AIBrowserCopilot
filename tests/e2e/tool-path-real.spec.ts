/**
 * REAL tool-path e2e — the regression gate for the 2026-06-19 playwright-path
 * fixes (navigating-click hang, empty snapshot after a navigating click, slow
 * screenshot, unbounded press/fill).
 *
 * Unlike click-and-form.spec.ts / tools.spec.ts (which drive inline
 * executeScript simulations) this exercises the ACTUAL production tool path:
 *
 *     MCP client (?role=mcp)  →  bridge  →  extension SW  →  playwright-crx  →  Chrome
 *
 * — the exact chain Claude Code / Cursor use, and the only place the fixed bugs
 * actually live. It talks MCP to the REAL running bridge and asserts behavior;
 * it deliberately does NOT launch its own Chromium (a Playwright-owned browser
 * contends for CDP with the extension's playwright-crx — the same reason the
 * repo's other real tests attach to an already-running browser).
 *
 * PREREQ (deliberate-run integration test, like the real-edge-* specs):
 *   - the native host / bridge is running, and
 *   - a real Chrome with the extension is connected to it.
 * That is the normal `agenthub` dev state. If no browser is connected the suite
 * skips with an explanatory message rather than failing spuriously.
 *
 *   npx playwright test tests/e2e/tool-path-real.spec.ts
 *   AGENTHUB_TEST_PORT=7483 npx playwright test tests/e2e/tool-path-real.spec.ts
 */
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const LIST_TABS_WEDGE_MS = 3000;

function installDir(): string {
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub');
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'agenthub');
  return join(homedir(), '.local', 'share', 'agenthub');
}
function bridgePort(): number {
  if (process.env.AGENTHUB_TEST_PORT) return Number(process.env.AGENTHUB_TEST_PORT);
  try {
    const lock = JSON.parse(readFileSync(join(installDir(), 'server.lock'), 'utf-8'));
    if (typeof lock.port === 'number') return lock.port;
  } catch { /* fall through */ }
  return 7483;
}

interface McpClient {
  call(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): void;
}

function connectMcp(port: number): Promise<McpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    let nextId = 1;
    ws.on('message', (data) => {
      for (const line of data.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: any;
        try { msg = JSON.parse(t); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id)!; pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', async () => {
      const rpc = (method: string, params: unknown, timeoutMs = 20000) => new Promise<any>((res, rej) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`rpc '${method}' timed out after ${timeoutMs}ms`)); }, timeoutMs);
        pending.set(id, { resolve: res, reject: rej, timer });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
      try {
        await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tool-path-e2e', version: '1' } }, 8000);
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        resolve({
          call: (name, args, timeoutMs) => rpc('tools/call', { name, arguments: args }, timeoutMs),
          close: () => { try { ws.close(); } catch { /* */ } },
        });
      } catch (e) { reject(e as Error); }
    });
  });
}

const allText = (r: any): string => (r?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
const firstImage = (r: any): { data?: string } | null => (r?.content ?? []).find((c: any) => c.type === 'image') ?? null;

let mcp: McpClient;
let firstTabId: string | null = null;

test.beforeAll(async () => {
  const port = bridgePort();
  try {
    mcp = await connectMcp(port);
  } catch (e) {
    test.skip(true, `No bridge reachable on :${port} (${(e as Error).message}). Start the bridge + connect a browser, then re-run.`);
    return;
  }
  // Need a connected browser with an http(s) tab to exercise tools against.
  try {
    const res = await mcp.call('list_tabs', {}, 8000);
    const parsed = JSON.parse(allText(res));
    const tabs: any[] = Array.isArray(parsed) ? parsed : (parsed.tabs ?? []);
    const httpTab = tabs.find((t) => typeof t.url === 'string' && /^https?:/.test(t.url)) ?? tabs[0];
    firstTabId = httpTab?.id ?? null;
  } catch { /* handled below */ }
  test.skip(!firstTabId, 'No connected browser with an http(s) tab. Connect a real Chrome with the extension, then re-run.');
});

test.afterAll(() => { mcp?.close(); });

test.describe.configure({ mode: 'serial' });

test('list_tabs round-trips through the real socket without wedging', async () => {
  const t0 = Date.now();
  const res = await mcp.call('list_tabs', {}, 8000);
  const dur = Date.now() - t0;
  const parsed = JSON.parse(allText(res));
  const tabs = Array.isArray(parsed) ? parsed : (parsed.tabs ?? []);
  expect(tabs.length).toBeGreaterThan(0);
  // A wedged orphan socket answers in ~10s with 0 tabs; a healthy one is fast.
  expect(dur).toBeLessThan(LIST_TABS_WEDGE_MS);
});

test('navigate + get_page_content returns the destination content', async () => {
  await mcp.call('navigate', { tab_id: firstTabId, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1200));
  const res = await mcp.call('get_page_content', { tab_id: firstTabId }, 12000);
  expect(allText(res)).toMatch(/example domain/i);
});

test('navigating click lands FAST with success — never the ~16-18s false-timeout', async () => {
  // example.com's single link navigates to iana.org. The bug made a landed
  // click hang ~16-18s and report an error (unbounded post-click re-resolve).
  await mcp.call('navigate', { tab_id: firstTabId, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1200));

  const t0 = Date.now();
  const res = await mcp.call('click_element', { tab_id: firstTabId, selector: 'a' }, 20000);
  const dur = Date.now() - t0;
  const text = allText(res);

  expect(res.isError).not.toBe(true);
  expect(text).toMatch(/"success":\s*true/);
  expect(dur).toBeLessThan(12000); // not the old hang
});

test('navigating click returns an honest snapshot — fresh refs OR an explicit loading note, never silent-empty', async () => {
  await mcp.call('navigate', { tab_id: firstTabId, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1200));
  const res = await mcp.call('click_element', { tab_id: firstTabId, selector: 'a' }, 20000);
  const text = allText(res);
  // Must contain the snapshot section, and it must be either real refs or the
  // "still loading" note — a navigating click never silently drops the snapshot.
  expect(text).toContain('Page Snapshot');
  expect(/Interactive elements/.test(text) || /still loading/i.test(text)).toBe(true);
});

test('take_screenshot returns a real image on a settled page (animations-disabled speed fix)', async () => {
  await mcp.call('navigate', { tab_id: firstTabId, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1500)); // let it settle (stable case)
  const t0 = Date.now();
  const res = await mcp.call('take_screenshot', { tab_id: firstTabId, format: 'jpeg' }, 15000);
  const dur = Date.now() - t0;
  const img = firstImage(res);
  expect(img?.data?.length ?? 0).toBeGreaterThan(1000);
  // Pre-fix a stable-page screenshot could take up to ~13s; with the stability
  // waits disabled it is well under the bridge fan-out ceiling.
  expect(dur).toBeLessThan(10000);
});

test('the page remains usable for the next tool after a navigating click', async () => {
  await mcp.call('navigate', { tab_id: firstTabId, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1200));
  await mcp.call('click_element', { tab_id: firstTabId, selector: 'a' }, 20000);
  // The click left the page settled (bounded click, not fire-and-forget), so a
  // follow-up read works — content is the truth source after a navigation.
  await new Promise((r) => setTimeout(r, 1500));
  const res = await mcp.call('get_page_content', { tab_id: firstTabId }, 12000);
  expect(allText(res).length).toBeGreaterThan(0);
});
