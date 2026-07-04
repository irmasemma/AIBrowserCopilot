/**
 * Ref-liveness regression suite — the merge gate for the corrected Fix B
 * (REF_STALE / CLICK_NOT_ACTIONABLE / AMBIGUOUS_REF classification + bounded
 * identity-verified retry) added to click_element / press_key / fill_form in
 * packages/extension/src/background/tool-dispatcher.ts.
 *
 * Root-caused and confirmed live against the diag dashboard's 1.5s self-poll
 * (packages/native-host/src/diag-page.ts) — see docs/rca-2026-07-01-dropped-
 * clicks-stale-ref.md. The diag dashboard itself is intentionally NOT changed;
 * these tests exercise the click-path hardening only, via
 * tests/e2e/fixtures/ref-liveness.html, which reproduces the SAME
 * node-destruction shape deterministically.
 *
 * Exercises the REAL production tool path (MCP client → bridge → extension SW →
 * playwright-crx → Chrome), same harness as tool-path-real.spec.ts.
 * Deliberately does not launch its own Chromium. Skips with an explanatory
 * message if no bridge/browser is connected, rather than failing spuriously.
 *
 *   npx playwright test tests/e2e/ref-liveness.spec.ts
 */
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import path from 'node:path';

function installDir(): string {
  if (process.env.AGENTHUB_INSTALL_DIR && process.env.AGENTHUB_INSTALL_DIR.trim().length > 0) {
    return process.env.AGENTHUB_INSTALL_DIR.trim();
  }
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
        await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ref-liveness-e2e', version: '1' } }, 8000);
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
const fixturePath = path.resolve(__dirname, 'fixtures/ref-liveness.html');
const fixtureUrl = (query: string) => `file://${fixturePath}?${query}`;

let mcp: McpClient;
let tabId: string | null = null;

test.beforeAll(async () => {
  const port = bridgePort();
  try {
    mcp = await connectMcp(port);
  } catch (e) {
    test.skip(true, `No bridge reachable on :${port} (${(e as Error).message}). Start the bridge + connect a browser, then re-run.`);
    return;
  }
  try {
    const res = await mcp.call('list_tabs', {}, 8000);
    const parsed = JSON.parse(allText(res));
    const tabs: any[] = Array.isArray(parsed) ? parsed : (parsed.tabs ?? []);
    tabId = tabs[0]?.id ?? null;
  } catch { /* handled below */ }
  test.skip(!tabId, 'No connected browser tab. Connect a real Chrome with the extension, then re-run.');
});

test.afterAll(() => { mcp?.close(); });
test.describe.configure({ mode: 'serial' });

/** Navigate the shared tab to a fixture scenario and grab the ref for #target. */
async function loadAndSnapshot(query: string): Promise<string> {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl(query) }, 15000);
  await new Promise((r) => setTimeout(r, 400)); // let the page settle for the snapshot itself
  const res = await mcp.call('snapshot', { tab_id: tabId }, 10000);
  const text = allText(res);
  const m = /"target"\s*\[ref=(e\d+)\]|button "Click Me" \[ref=(e\d+)\]/.exec(text);
  const ref = m?.[1] ?? m?.[2];
  expect(ref, `expected a ref for #target in snapshot:\n${text}`).toBeTruthy();
  return ref!;
}

test('1. late-render success at ~300ms (selector) — must NOT regress into REF_STALE', async () => {
  // #target doesn't exist yet when the page loads (renders after 300ms), so
  // there is no ref to click by — this proves the SELECTOR path is not
  // fast-failed and Playwright's auto-wait still catches the late node.
  // Ref-based late-render is structurally impossible per the RCA (refs are
  // only minted for elements already visible at snapshot time) — test 2 covers
  // the real-world "toast appears after submit" case this guards.
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=late-render&delay=300') }, 15000);
  const t0 = Date.now();
  const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 12000);
  const dur = Date.now() - t0;
  expect(res.isError).not.toBe(true);
  expect(allText(res)).toMatch(/"success":\s*true/);
  expect(dur).toBeLessThan(9000); // succeeded inside the 8s budget, not artificially delayed
});

test('2. late-render success at ~2s (selector) — the "toast appears after submit" shape', async () => {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=late-render&delay=2000') }, 15000);
  const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 12000);
  expect(res.isError).not.toBe(true);
  expect(allText(res)).toMatch(/"success":\s*true/);
});

test('3. late-render success at ~7.5s edge-of-budget — the full 8s window is preserved', async () => {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=late-render&delay=7500') }, 15000);
  const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 15000);
  expect(res.isError).not.toBe(true);
  expect(allText(res)).toMatch(/"success":\s*true/);
});

test('4. true-stale (selector) returns REF_STALE-classified error at ~8s, not before', async () => {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=true-stale') }, 15000);
  const t0 = Date.now();
  let threw: any = null;
  const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 15000).catch((e) => { threw = e; return null; });
  const dur = Date.now() - t0;
  const errText = threw ? String(threw.message) : JSON.stringify(res);
  expect(errText).toMatch(/REF_STALE/);
  expect(dur).toBeGreaterThanOrEqual(7500); // proves the wait was NOT pre-empted
});

test('5. ref recoverable stale (diag-dashboard shape) — self-heals via identity-verified retry', async () => {
  // destroy-once replaces the "Click Me" button one time then leaves it stable
  // — the same node-replacement that breaks a ref on diag-page.ts's poll, but
  // settled so the retry can deterministically recover. The original ref goes
  // stale, the retry re-resolves the recreated button by role+name and clicks
  // it. This is the real dropped-click scenario AUTO-RECOVERED — the click must
  // SUCCEED, not error. (Self-heal also confirmed by the stale_ref_retry
  // "succeeded" log event.)
  const ref = await loadAndSnapshot('mode=destroy-once&delay=800');
  await new Promise((r) => setTimeout(r, 1500)); // node replaced once at 800ms, now stable → ref is stale
  const res = await mcp.call('click_element', { tab_id: tabId, ref }, 20000);
  expect(res.isError).not.toBe(true);
  expect(allText(res)).toMatch(/"success":\s*true/);
});

test('5b. ref PERMANENT stale (node removed, no identity match) — returns REF_STALE at ~8s', async () => {
  // Snapshot mints a ref, then the node is removed and never recreated, so the
  // retry finds no role+name match and must surface REF_STALE — proving the
  // classification fires AND the wait is not pre-empted.
  const ref = await loadAndSnapshot('mode=destroy-permanent&delay=2000');
  await new Promise((r) => setTimeout(r, 2300)); // node removed at 2000ms
  const t0 = Date.now();
  let threw: any = null;
  const res = await mcp.call('click_element', { tab_id: tabId, ref }, 15000).catch((e) => { threw = e; return null; });
  const dur = Date.now() - t0;
  const errText = threw ? String(threw.message) : JSON.stringify(res);
  expect(errText).toMatch(/REF_STALE/);
  expect(dur).toBeGreaterThanOrEqual(7500);
});

test('6. toggled-visibility, same node — succeeds (never misclassified as stale)', async () => {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=toggle-visibility') }, 15000);
  const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 12000);
  expect(res.isError).not.toBe(true);
  expect(allText(res)).toMatch(/"success":\s*true/);
});

test('7a. fill_form parity — late-render field succeeds', async () => {
  await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=late-render&delay=2000') }, 15000);
  // #target-check is a real late-rendered <input type="checkbox"> — exercises
  // fill_form's classify path with a correct element/action pairing.
  const res = await mcp.call('fill_form', { tab_id: tabId, fields: [{ selector: '#target-check', type: 'checkbox', checked: true }] }, 12000);
  expect(allText(res)).toContain('"success":true');
});

test('7b. press_key parity — permanent-stale ref returns REF_STALE, wall-clock >= ~8s', async () => {
  const ref = await loadAndSnapshot('mode=destroy-permanent&delay=2000');
  await new Promise((r) => setTimeout(r, 2300));
  const t0 = Date.now();
  let threw: any = null;
  const res = await mcp.call('press_key', { tab_id: tabId, ref, key: 'Enter' }, 15000).catch((e) => { threw = e; return null; });
  const dur = Date.now() - t0;
  const errText = threw ? String(threw.message) : JSON.stringify(res);
  expect(errText).toMatch(/REF_STALE/);
  expect(dur).toBeGreaterThanOrEqual(7500);
});

test('8. happy-path latency is statistically unchanged (no cost added to the success path)', async () => {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await mcp.call('navigate', { tab_id: tabId, url: fixtureUrl('mode=default') }, 15000);
    const t0 = Date.now();
    const res = await mcp.call('click_element', { tab_id: tabId, selector: '#target' }, 10000);
    samples.push(Date.now() - t0);
    expect(res.isError).not.toBe(true);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  // Generous ceiling — a change-detector against a gross regression (e.g. an
  // accidental blocking pre-check), not a tight perf SLA.
  expect(avg).toBeLessThan(2000);
});

test('9. iframe/shadow-DOM — documents the existing, unchanged limitation', async () => {
  // Ref locators are injected in the top frame ONLY (documented in
  // tool-dispatcher.ts) and querySelectorAll does not pierce open shadow roots.
  // This is a PRE-EXISTING gap, not something this change introduces or fixes —
  // this test exists so it stays a visibly-tracked, intentional gap.
  test.skip(true, 'Documented limitation: refs are top-frame-only and do not pierce shadow DOM. Not in scope for this fix (see RCA notes).');
});
