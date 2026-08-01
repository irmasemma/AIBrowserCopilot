/**
 * 1-hour stability SOAK: two real (bundled Chromium) browsers on one bridge,
 * each driven by its own real Claude CLI session that re-runs an export every
 * 5 minutes. Watches for connection drops / SW eviction / bridge instability.
 *
 *   Browser A — local fixture feed on http://127.0.0.1 (in host_permissions,
 *               so full export works; requires >5 posts each cycle).
 *   Browser B — a live public site (default https://stackoverflow.com/questions;
 *               override with SOAK_SECOND_URL / SOAK_SECOND_MATCH). The fresh
 *               profile lacks <all_urls>, so extraction may be permission-
 *               limited; we DON'T require >5 — only that the tools run and the
 *               connection stays healthy.
 *
 * Each 5-minute cycle:
 *   1. snapshot bridge /api/state (both browsers present + liveness)
 *   2. Claude session A exports the fixture tab  (assert >5 posts)
 *   3. Claude session B operates the threads tab (record count + tools)
 *   4. snapshot /api/state again, append a timeline row
 * Runs for SOAK_DURATION_MIN, then asserts: every cycle saw BOTH browsers
 * live, and the fixture export returned >5 every cycle. The per-cycle timeline
 * (test-results/soak-timeline.ndjson) shows exactly when/if anything dropped.
 *
 * Config (env): SOAK_DURATION_MIN=60  SOAK_INTERVAL_MIN=5
 *   SOAK_THREADS_URL=https://www.threads.com/@tech.mom_us
 * Quick smoke: SOAK_DURATION_MIN=2 SOAK_INTERVAL_MIN=1
 *
 * Prereqs: `claude` on PATH + logged in; the `agenthub` MCP server registered
 * (the real install provides it; it proxies to whoever owns :7483 = this test
 * bridge). Headed. Browsers/claude are NOT torn down between cycles.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '../..');
const extensionPath = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
// Replaced in beforeAll with a host-access-patched copy (see buildPatchedExtension).
let loadExtensionPath = extensionPath;
const nativeHostDist = path.resolve(REPO_ROOT, 'packages/native-host/dist/index.js');
const FIXTURE_PER_PAGE = 100;
const FIXTURE_PAGES = 2;
/**
 * Browser A fixture: a 2-page feed (100 records/page) that genuinely requires
 * BOTH scroll and pagination:
 *  - Records LAZY-LOAD in chunks of 20 as you scroll (so get_page_content cannot
 *    read all 100 without scrolling — a static page would defeat the scroll test).
 *  - The "Next page" link is hidden until all 100 are loaded, forcing scroll THEN
 *    pagination to a real second URL (/?page=2).
 */
const fixturePageHtml = (page: number): string => {
  const start = (page - 1) * FIXTURE_PER_PAGE + 1;
  const items = Array.from({ length: FIXTURE_PER_PAGE }, (_, i) => ({
    id: start + i,
    text: `Record ${start + i} — sample feed item for scroll/pagination testing`,
  }));
  const nav = page < FIXTURE_PAGES
    ? `<a id="next-page" href="/?page=${page + 1}">Next page &rarr;</a>`
    : `<a id="prev-page" href="/?page=${page - 1}">&larr; Previous page</a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test Feed — Page ${page} of ${FIXTURE_PAGES}</title>
<style>body{font-family:sans-serif;margin:0}h1{position:sticky;top:0;background:#fff;padding:12px;margin:0;border-bottom:1px solid #ccc;font-size:16px}
.post{min-height:90px;padding:16px;border-bottom:1px solid #eee}#pager{display:none;padding:24px;font-size:18px}</style></head>
<body>
<h1>Test Feed — Page ${page} of ${FIXTURE_PAGES} <span id="count">(0 loaded)</span></h1>
<div id="feed"></div>
<div id="pager">${nav}</div>
<script>
const ALL=${JSON.stringify(items)};let rendered=0;const feed=document.getElementById('feed');
function renderMore(){const next=ALL.slice(rendered,rendered+20);for(const it of next){const a=document.createElement('article');a.className='post';a.setAttribute('data-id',String(it.id));a.innerHTML='<h3>Post #'+it.id+'</h3><p>'+it.text+'</p>';feed.appendChild(a);}rendered+=next.length;document.getElementById('count').textContent='('+rendered+' loaded)';if(rendered>=ALL.length){document.getElementById('pager').style.display='block';}}
renderMore();
window.addEventListener('scroll',function(){if(window.innerHeight+window.scrollY>=document.body.offsetHeight-120){renderMore();}});
</script></body></html>`;
};

const DURATION_MIN = Number(process.env.SOAK_DURATION_MIN ?? 60);
const INTERVAL_MIN = Number(process.env.SOAK_INTERVAL_MIN ?? 5);
// Browser B opens a real public site. Default: Stack Overflow's question list
// (no login wall, lots of list items). Override with SOAK_SECOND_URL.
const SECOND_URL = process.env.SOAK_SECOND_URL ?? 'https://stackoverflow.com/questions';
const SECOND_MATCH = process.env.SOAK_SECOND_MATCH ?? 'stackoverflow.com';
const TIMELINE = path.resolve(REPO_ROOT, 'test-results/soak-timeline.ndjson');
const EXPORT_DIR = path.resolve(REPO_ROOT, 'test-results/exports');

interface Client { label: string; context: BrowserContext; uuid: string; browserId: string; page: Page; extId: string }

/**
 * RCA instrumentation: read this browser's CURRENT stored instance UUID +
 * connection state straight from the extension, so we can tell whether the id
 * actually changed mid-run (code bug) vs. the test holding a stale id (test bug).
 */
const readLiveIdentity = async (c: Client): Promise<{ storedUuid?: string; state?: string }> => {
  const page = await c.context.newPage();
  try {
    await page.goto(`chrome-extension://${c.extId}/sidepanel.html`);
    return await page.evaluate(async () => {
      const d = await chrome.storage.local.get(['connectionContext', 'browserInstanceUuid']);
      return {
        storedUuid: d.browserInstanceUuid as string | undefined,
        state: (d.connectionContext as { state?: string } | undefined)?.state,
      };
    });
  } catch { return {}; } finally { await page.close().catch(() => {}); }
};

/**
 * Capability check — the real question isn't `permissions.contains()` (which
 * false-negatives: it reported <all_urls> absent while page reads succeeded),
 * it's "can the extension actually READ this page?". Inject a content read into
 * the live tab via chrome.scripting; success = host access is effectively there.
 */
const canReadPage = async (ctx: BrowserContext, extId: string, urlMatch: string): Promise<boolean> => {
  const page = await ctx.newPage();
  try {
    await page.goto(`chrome-extension://${extId}/sidepanel.html`);
    // Poll up to 15s. Each attempt returns:
    //   -1  → executeScript threw (host access genuinely BLOCKED, or no tab yet)
    //    0  → readable but page not finished loading (keep waiting)
    //   >0  → real content read. This separates "still loading" (retry) from
    //         "blocked" (stays -1), so the gate matches the real extraction path.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const len = await page.evaluate(async (match) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url ?? '').includes(match));
        if (!tab?.id) return -1;
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ ready: document.readyState, len: (document.body?.innerText ?? '').length }),
          });
          const res = r?.result as { ready?: string; len?: number } | undefined;
          return res && res.ready === 'complete' ? (res.len ?? 0) : 0;
        } catch { return -1; }
      }, urlMatch);
      if (len > 200) return true; // real content readable
      await sleep(1000);
    }
    return false;
  } catch { return false; } finally { await page.close().catch(() => {}); }
};

/** Temp Chrome profile dirs created per run — removed in afterAll so they don't
 * accumulate and fill the disk (a leak that previously hit 100% and broke runs). */
const tempProfiles: string[] = [];

/** Every launched context — tracked so afterAll can close even a context whose
 * setup failed (otherwise Chrome keeps its profile locked and it can't be deleted). */
const allContexts: BrowserContext[] = [];

/**
 * Build a host-access-patched copy of the built extension and return its path.
 *
 * The shipped manifest keeps `<all_urls>` in `optional_host_permissions`, which
 * requires a runtime "Allow on all sites" grant — unreliable in automated
 * Chromium (the auto-approve flag doesn't consistently approve broad patterns).
 * Here we copy the extension and promote the SPECIFIC test origins into
 * `host_permissions`. Specific (non-broad) host patterns are granted at load with
 * no "on click" default, so reads work deterministically — no runtime prompt.
 * This is TEST-ONLY: the real shipped extension is untouched.
 */
const buildPatchedExtension = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-soak-ext-'));
  tempProfiles.push(dir); // reuse the afterAll cleanup
  fs.cpSync(extensionPath, dir, { recursive: true });
  const mfPath = path.join(dir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')) as { host_permissions?: string[] };
  mf.host_permissions = Array.from(new Set([
    ...(mf.host_permissions ?? []),
    'https://stackoverflow.com/*',
    'https://*.stackoverflow.com/*',
  ]));
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return dir;
};

let bridge: ChildProcess;
let bridgePort: number;
let fixtureServer: http.Server;
let fixtureUrl: string;
const clients: Client[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const launch = (udd: string): Promise<BrowserContext> =>
  chromium.launchPersistentContext(udd, {
    headless: false,
    args: [
      `--disable-extensions-except=${loadExtensionPath}`,
      `--load-extension=${loadExtensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

const findExtId = async (ctx: BrowserContext): Promise<string> => {
  await sleep(2500);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 6000 }));
  return sw.url().split('/')[2];
};

const waitConnectedUuid = async (ctx: BrowserContext, extId: string): Promise<string> => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  try {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(async () => {
        const d = await chrome.storage.local.get(['connectionContext', 'browserInstanceUuid']);
        return {
          state: (d.connectionContext as { state?: string } | undefined)?.state,
          uuid: d.browserInstanceUuid as string | undefined,
        };
      });
      if (s.state === 'connected' && s.uuid) return s.uuid;
      await sleep(500);
    }
    throw new Error('extension did not connect within 25s');
  } finally {
    await page.close();
  }
};

/** Bridge /api/state → which browsers are present and their liveness. */
const fetchState = async (port: number): Promise<Record<string, string>> => {
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/state`, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('state timeout')); });
  });
  const out: Record<string, string> = {};
  try {
    const s = JSON.parse(body) as { browsers?: Array<{ id?: string; browserId?: string; liveness?: string }> };
    for (const b of s.browsers ?? []) {
      const id = b.id ?? b.browserId; if (id) out[id] = b.liveness ?? 'unknown';
    }
  } catch { /* leave empty → treated as a drop */ }
  return out;
};

/**
 * Verify the remote-log pipeline end-to-end by POSTing one sentinel record to
 * the ingest endpoint with this run's install_id. The remote-sink is silent
 * (fire-and-forget, no log events), so this direct probe is the only way to
 * confirm endpoint + key + Neon insert actually work. A 200 with inserted>=1
 * means the real (same-endpoint/key) sink will land rows too. The probe row
 * shares the install_id, so it shows up in the same verify query.
 */
const probeRemoteIngest = (
  endpoint: string,
  apiKey: string,
  installId: string,
): Promise<{ ok: boolean; status: number; inserted?: number; error?: string }> =>
  new Promise((resolve) => {
    let u: URL;
    try { u = new URL(endpoint); } catch { return resolve({ ok: false, status: 0, error: 'bad_url' }); }
    const body = JSON.stringify({
      installId,
      records: [{
        t: new Date().toISOString(), src: 'bridge', lvl: 'info',
        event: 'soak.ship-probe', version: 'soak',
        note: 'two-browser soak remote-log connectivity probe',
      }],
    });
    const payload = Buffer.from(body, 'utf-8');
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search,
      headers: { 'content-type': 'application/json', 'content-length': payload.length, 'x-ingest-key': apiKey },
      timeout: 10_000,
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => {
        let inserted: number | undefined;
        try { inserted = (JSON.parse(d) as { inserted?: number }).inserted; } catch { /* non-json */ }
        const status = res.statusCode ?? 0;
        resolve({ ok: status === 200, status, inserted, error: status === 200 ? undefined : d.slice(0, 160) });
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.write(payload); req.end();
  });

/**
 * Resolve the remote-log endpoint + key. Remote is **ON by default** — set
 * SOAK_REMOTE_LOGS=0 to force it off. Creds come from env first
 * (SOAK_LOG_ENDPOINT / SOAK_LOG_KEY), else are auto-loaded from this machine's
 * local files (never hard-coded, never committed):
 *   - key      → packages/log-ingest/.env.production.local (`INGEST_KEY`)
 *   - endpoint → %LOCALAPPDATA%/agenthub/logs-config.json (`remote.endpoint`)
 * Returns null only when explicitly disabled or creds can't be found.
 */
function resolveRemote(): { endpoint: string; apiKey: string } | null {
  if (process.env.SOAK_REMOTE_LOGS === '0') return null;
  let endpoint = process.env.SOAK_LOG_ENDPOINT ?? '';
  let apiKey = process.env.SOAK_LOG_KEY ?? '';
  if (!apiKey) {
    try {
      const env = readFileSync(path.resolve(REPO_ROOT, 'packages/log-ingest/.env.production.local'), 'utf8');
      const m = env.match(/^\s*INGEST_KEY\s*=\s*(.+?)\s*$/m);
      if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* no local key file */ }
  }
  if (!endpoint) {
    try {
      const lcPath = path.join(process.env.LOCALAPPDATA ?? '', 'agenthub', 'logs-config.json');
      const lc = JSON.parse(readFileSync(lcPath, 'utf8')) as { remote?: { endpoint?: string } };
      endpoint = lc.remote?.endpoint ?? '';
    } catch { /* no local logs-config */ }
  }
  return endpoint && apiKey ? { endpoint, apiKey } : null;
}

interface ExportResult { tools: string[]; posts: number; items: unknown[]; screenshot: string; exitCode: number; raw: string }

/**
 * One real Claude CLI session running `prompt` against the connected browsers.
 * Captures: the agenthub MCP tools used, the JSON array the LLM exported, and
 * the screenshot image (base64) returned by take_screenshot.
 */
const runExport = async (prompt: string, model = 'haiku', timeoutMs = 150_000): Promise<ExportResult> => {
  const child = spawn('claude',
    ['--print', '--input-format', 'text', '--output-format', 'stream-json', '--verbose',
      '--model', model, '--dangerously-skip-permissions'],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true });
  child.stdin.end(prompt);

  const tools: string[] = [];
  let text = ''; let raw = ''; let screenshot = '';
  child.stdout.on('data', (d: Buffer) => {
    raw += d.toString(); let nl: number;
    while ((nl = raw.indexOf('\n')) !== -1) {
      const line = raw.slice(0, nl); raw = raw.slice(nl + 1);
      if (!line.trim()) continue;
      let m: { type?: string; message?: { content?: unknown[] }; result?: string };
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'assistant') for (const b of (m.message?.content ?? []) as Array<{ type?: string; name?: string; text?: string }>) {
        if (b.type === 'tool_use' && b.name) tools.push(b.name);
        if (b.type === 'text' && b.text) text += '\n' + b.text;
      }
      // tool_result for take_screenshot carries the PNG as a base64 image block.
      if (m.type === 'user') for (const b of (m.message?.content ?? []) as Array<{ type?: string; content?: unknown }>) {
        if (b.type !== 'tool_result' || !Array.isArray(b.content)) continue;
        for (const c of b.content as Array<{ type?: string; data?: string; source?: { data?: string } }>) {
          const data = c?.source?.data ?? (c?.type === 'image' ? c?.data : undefined);
          if (c?.type === 'image' && data && !screenshot) screenshot = data;
        }
      }
      if (m.type === 'result' && m.result) text += '\n' + m.result;
    }
  });
  const exitCode: number = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } resolve(-2); }, timeoutMs);
    child.on('exit', (c) => { clearTimeout(t); resolve(c ?? -1); });
    child.on('error', () => { clearTimeout(t); resolve(-3); });
  });
  let items: unknown[] = [];
  const j = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text.match(/\[\s*\{[\s\S]*?\}\s*\]/)?.[0] ?? '';
  try { const p = JSON.parse(j.trim()); if (Array.isArray(p)) items = p; } catch { /* [] */ }
  return { tools: [...new Set(tools.filter((t) => t.startsWith('mcp__agenthub__')))], posts: items.length, items, screenshot, exitCode, raw: text };
};

/** Prompt for the local fixture feed (browser A). */
const fixturePrompt = (match: string): string => [
  'You are operating a real Chrome browser through the agenthub MCP tools.',
  `Operate ONLY on the tab whose URL contains "${match}". It shows a 2-page feed`,
  '(100 records per page) where records LAZY-LOAD as you scroll — they are NOT all',
  'in the page until you scroll down.',
  '',
  'Do this:',
  '1. Find the tab (mcp__agenthub__list_tabs).',
  '2. Take a screenshot (mcp__agenthub__take_screenshot).',
  '3. Scroll down repeatedly with mcp__agenthub__scroll_page until ALL 100 records',
  '   on this page are loaded — the "Next page" link (id="next-page") only appears',
  '   once everything is loaded.',
  '4. Read every record with mcp__agenthub__get_page_content or extract_data.',
  '5. Then go to the SECOND page by clicking the "Next page" link with',
  '   mcp__agenthub__click_element. Scroll it the same way and read all its records.',
  '',
  'Collect records from BOTH pages. Output ONLY a JSON array of',
  '{"id": number, "text": string} (about 200 items, ids spanning 1..200) in a',
  '```json block. No prose.',
].join(' ');

/** Prompt for the live Stack Overflow questions list (browser B). */
const stackOverflowPrompt = (match: string): string => [
  'You are operating a real Chrome browser through the agenthub MCP tools. One tab',
  `is showing a Stack Overflow "Questions" list (its URL contains "${match}").`,
  'Your job: export the questions from that page. Work entirely through the MCP tools',
  '— do not assume anything; look at the page and react to what is actually there.',
  '',
  'Do this:',
  '1. Find the right tab (list the tabs and pick the Stack Overflow one).',
  '2. Look at the page (a snapshot or its content). If anything is covering the',
  '   questions — a cookie/consent banner, a dialog, a "got it" notice — dismiss it',
  '   by clicking the appropriate button so the question list is fully visible.',
  '3. Take a screenshot of the page with mcp__agenthub__take_screenshot. This is',
  '   REQUIRED on every run — always call it, even if you also read the content.',
  '4. Scroll down repeatedly to load more questions until at least 15 are present.',
  '5. Read the questions and, for each, capture: its title, the number of votes, the',
  '   number of answers, and the number of views.',
  '',
  'Finally output ONLY a JSON array (at least 15 items) of',
  '{"title": string, "votes": number, "answers": number, "views": number}',
  'inside a ```json code block. No prose before or after it.',
].join(' ');

test.describe('two-browser soak (fixture + live public site)', () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    if (process.platform === 'win32') {
      try { execSync('taskkill /F /IM agenthub-win-x64.exe', { stdio: 'ignore' }); } catch { /* none */ }
    } else {
      try { execSync('pkill -f agenthub', { stdio: 'ignore' }); } catch { /* none */ }
    }
    await sleep(500);

    const installParent = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-soak-'));
    const installDir = path.join(installParent, 'agenthub');
    const lockFile = path.join(installDir, 'server.lock');
    fs.mkdirSync(installDir, { recursive: true });

    // Ship bridge + extension log records to the Neon-backed ingest endpoint.
    // ON by default (SOAK_REMOTE_LOGS=0 to disable); creds resolved from env or
    // local files. The bridge reads <installDir>/logs-config.json at startup
    // (initRemoteSink).
    const remote = resolveRemote();
    if (remote) {
      writeFileSync(
        path.join(installDir, 'logs-config.json'),
        JSON.stringify({ enabled: true, remote: { enabled: true, endpoint: remote.endpoint, apiKey: remote.apiKey } }, null, 2),
      );
    } else if (process.env.SOAK_REMOTE_LOGS !== '0') {
      console.warn('[soak] remote logs ON by default but endpoint/key not resolvable — running WITHOUT remote');
    }

    bridge = spawn('node', [nativeHostDist], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: '1', LOCALAPPDATA: installParent, AGENTHUB_INSTALL_DIR: installDir },
    });
    let exited: number | null = null;
    bridge.on('exit', (c) => { exited = c ?? -1; });
    bridgePort = await new Promise<number>((resolve, reject) => {
      const deadline = Date.now() + 15_000;
      const poll = () => {
        if (exited !== null) return reject(new Error(`bridge exited: ${exited}`));
        try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { port?: number; pid?: number };
          if (l.port && l.pid === bridge.pid) return resolve(l.port); } catch { /* wait */ }
        if (Date.now() > deadline) return reject(new Error('bridge never claimed :7483'));
        setTimeout(poll, 250);
      };
      poll();
    });

    fixtureServer = http.createServer((q, res) => {
      const m = /[?&]page=(\d+)/.exec(q.url ?? '');
      const page = m ? Math.min(FIXTURE_PAGES, Math.max(1, Number(m[1]))) : 1;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixturePageHtml(page));
    });
    const fixturePort = await new Promise<number>((resolve) =>
      fixtureServer.listen(0, '127.0.0.1', () => resolve((fixtureServer.address() as import('net').AddressInfo).port)));
    fixtureUrl = `http://127.0.0.1:${fixturePort}/`;

    // Load a host-access-patched copy so reads work without the flaky runtime grant.
    loadExtensionPath = buildPatchedExtension();

    // Browser A — fixture; Browser B — live public site (Stack Overflow).
    for (const [label, url] of [['A-fixture', fixtureUrl], ['B-second', SECOND_URL]] as const) {
      const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `copilot-soak-${label}-`));
      tempProfiles.push(profileDir);
      const ctx = await launch(profileDir);
      allContexts.push(ctx);
      const extId = await findExtId(ctx);
      const uuid = await waitConnectedUuid(ctx, extId);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { /* live site may be slow */ });
      await sleep(1500);
      // Host access is pre-granted via the patched manifest, so reads should work
      // with no runtime prompt. Verify with a real read (canReadPage uses
      // chrome.scripting, the same path as get_page_content — ground truth, unlike
      // permissions.contains() which false-negatives).
      const match = label === 'A-fixture' ? '127.0.0.1' : SECOND_MATCH;
      const canRead = await canReadPage(ctx, extId, match);
      // eslint-disable-next-line no-console
      console.log(`[soak] ${label}: canReadPage=${canRead}`);
      // HARD requirement: must be able to read page content or the run is
      // meaningless. SOAK_REQUIRE_GRANT=0 downgrades to a warning (RCA runs).
      if (process.env.SOAK_REQUIRE_GRANT !== '0') {
        expect(canRead, `${label}: extension cannot read page content — aborting`).toBe(true);
      } else if (!canRead) {
        // eslint-disable-next-line no-console
        console.warn(`[soak] ${label}: cannot read page content but continuing (SOAK_REQUIRE_GRANT=0)`);
      }
      clients.push({ label, context: ctx, uuid, browserId: `chrome:${uuid}`, page, extId });
    }
    expect(clients[0].uuid).not.toBe(clients[1].uuid);

    mkdirSync(path.dirname(TIMELINE), { recursive: true });
    // install-id is what correlates this run's rows in Neon (logs.install_id).
    // The bridge writes it on first remote-sink init; surface it so you can
    // query exactly this run.
    let installId = '';
    try { installId = readFileSync(path.join(installDir, 'install-id'), 'utf8').trim(); } catch { /* remote off */ }
    const remoteOn = Boolean(remote);
    let shipProbe: { ok: boolean; status: number; inserted?: number; error?: string } | null = null;
    if (remote) {
      shipProbe = await probeRemoteIngest(remote.endpoint, remote.apiKey, installId);
      console.log(`[soak] remote logs ON → endpoint=${remote.endpoint} install_id=${installId || '(none)'}`);
      console.log(`[soak] ship probe: ${shipProbe.ok ? `OK (HTTP ${shipProbe.status}, inserted=${shipProbe.inserted})` : `FAILED (status=${shipProbe.status} ${shipProbe.error ?? ''})`}`);
      // Fail fast: if you asked for remote logs but the pipeline rejects us,
      // surface it now rather than discovering empty Neon hours later.
      expect(shipProbe.ok, `remote-log ship probe failed: ${JSON.stringify(shipProbe)}`).toBe(true);
    }
    appendFileSync(TIMELINE, JSON.stringify({ event: 'start', durationMin: DURATION_MIN, intervalMin: INTERVAL_MIN, remoteLogs: remoteOn, installId, shipProbe, browsers: clients.map((c) => ({ label: c.label, browserId: c.browserId })) }) + '\n');
  });

  test.afterAll(async () => {
    for (const ctx of allContexts) { try { await ctx.close(); } catch { /* noop */ } }
    await new Promise<void>((r) => fixtureServer ? fixtureServer.close(() => r()) : r());
    if (bridge && !bridge.killed) { bridge.kill(); await sleep(400); }
    // Remove this run's temp Chrome profiles so they don't accumulate and fill
    // the disk (a leak that previously reached 100% and broke startup/grant/reads).
    // Windows holds Chrome profile/extension file locks for a while after close,
    // so retry with an escalating backoff (up to ~15s/dir) until the dir is gone.
    for (const dir of tempProfiles) {
      for (let i = 0; i < 12; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ }
        if (!fs.existsSync(dir)) break;
        await sleep(500 + i * 200);
      }
    }
  });

  test(`soak ${DURATION_MIN}min @ ${INTERVAL_MIN}min cadence — connection stays healthy`, async () => {
    test.setTimeout((DURATION_MIN + 12) * 60_000);
    const fixture = clients[0]; const real = clients[1];
    const endAt = Date.now() + DURATION_MIN * 60_000;
    const drops: string[] = []; const fixtureShort: string[] = [];
    const secondShort: string[] = []; const secondNoShot: string[] = []; let cycle = 0;

    while (Date.now() < endAt) {
      cycle += 1;
      const cycleStart = Date.now();
      const before = await fetchState(bridgePort);
      // Fixture now requires scroll (lazy-load) + pagination across 200 records —
      // use a stronger model and a longer timeout (the heavier job overran the
      // default 150s, producing empty extractions).
      const resA = await runExport(fixturePrompt('127.0.0.1'), process.env.SOAK_FIXTURE_MODEL ?? 'sonnet', 300_000);
      // SO needs >=15 structured questions (votes/answers/views) off a live
      // page — use a stronger model for reliable structured extraction.
      const resB = await runExport(stackOverflowPrompt(SECOND_MATCH), process.env.SOAK_SECOND_MODEL ?? 'sonnet');
      const after = await fetchState(bridgePort);

      const healthy = (st: Record<string, string>, id: string) => st[id] === 'live';
      const bothLive = ['before', 'after'].every((_w, i) => {
        const st = i === 0 ? before : after;
        return healthy(st, fixture.browserId) && healthy(st, real.browserId);
      });
      // RCA: when a "drop" is detected, capture each browser's CURRENT identity
      // and the bridge's full live set, so we can classify: did the stored UUID
      // change (code bug), or is the recorded id stale while a NEW id is live
      // (reconnect-under-new-id), or is the bridge genuinely missing it?
      let identityProbe: unknown = null;
      if (!bothLive) {
        identityProbe = {
          fixture: { recorded: fixture.uuid, live: await readLiveIdentity(fixture) },
          second: { recorded: real.uuid, live: await readLiveIdentity(real) },
          bridgeIds: Object.keys(after),
        };
        drops.push(`cycle ${cycle}: before=${JSON.stringify(before)} after=${JSON.stringify(after)} identity=${JSON.stringify(identityProbe)}`);
      }
      // Browser A (fixture): must exercise BOTH scroll (records lazy-load) and
      // pagination (reach page 2). Verify via tools used + ids spanning both pages,
      // not just a raw count (a count alone wouldn't prove scroll/pagination).
      const fixtureIds = (resA.items as unknown[])
        .map((r) => (r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined))
        .filter((n): n is number => typeof n === 'number');
      const usedScroll = resA.tools.includes('mcp__agenthub__scroll_page');
      const reachedPage2 = fixtureIds.some((id) => id > FIXTURE_PER_PAGE);
      const fixtureOk = resA.posts >= 150 && usedScroll && reachedPage2;
      if (!fixtureOk) fixtureShort.push(`cycle ${cycle}: fixture posts=${resA.posts} scroll=${usedScroll} page2=${reachedPage2} tools=${resA.tools.join(',')}`);

      // Browser B (Stack Overflow): want >=15 questions carrying votes/answers/
      // views, plus a screenshot — all produced by the LLM via MCP.
      const hasField = (o: unknown, k: string) => o && typeof o === 'object' && k in (o as Record<string, unknown>);
      const secondWithFields = (resB.items as unknown[]).filter(
        (q) => hasField(q, 'votes') && hasField(q, 'answers') && hasField(q, 'views'),
      ).length;
      if (resB.posts < 15) secondShort.push(`cycle ${cycle}: SO questions=${resB.posts} withFields=${secondWithFields} tools=${resB.tools.join(',')}`);
      if (!resB.screenshot) secondNoShot.push(`cycle ${cycle}`);

      // Save what each LLM session exported (items + tools) and its screenshot.
      mkdirSync(EXPORT_DIR, { recursive: true });
      const cy = String(cycle).padStart(3, '0');
      const writeExport = (name: string, r: ExportResult, shotFile: string) => {
        if (r.screenshot) writeFileSync(path.join(EXPORT_DIR, shotFile), Buffer.from(r.screenshot, 'base64'));
        writeFileSync(path.join(EXPORT_DIR, `${name}.json`), JSON.stringify({
          count: r.posts, tools: r.tools, exit: r.exitCode,
          screenshot: r.screenshot ? { file: shotFile, bytes: Buffer.byteLength(r.screenshot, 'base64') } : null,
          rawTail: r.raw.slice(-1500),
          items: r.items,
        }, null, 2));
      };
      writeExport(`cycle${cy}-fixture`, resA, `cycle${cy}-fixture.png`);
      writeExport(`cycle${cy}-second`, resB, `cycle${cy}-second.png`);

      appendFileSync(TIMELINE, JSON.stringify({
        cycle, t: new Date().toISOString(),
        before, after, bothLive, identityProbe,
        fixture: { posts: resA.posts, tools: resA.tools, exit: resA.exitCode, screenshot: Boolean(resA.screenshot) },
        second: { posts: resB.posts, withFields: secondWithFields, tools: resB.tools, exit: resB.exitCode, screenshot: Boolean(resB.screenshot) },
      }) + '\n');
      // eslint-disable-next-line no-console
      console.log(`[soak] cycle ${cycle} bothLive=${bothLive} fixture=${resA.posts} SO=${resB.posts}(fields ${secondWithFields}) SOshot=${Boolean(resB.screenshot)}`);

      if (Date.now() >= endAt) break;
      const waitMs = cycleStart + INTERVAL_MIN * 60_000 - Date.now();
      if (waitMs > 0) await sleep(waitMs);
    }

    appendFileSync(TIMELINE, JSON.stringify({ event: 'end', cycles: cycle, drops: drops.length, fixtureShort: fixtureShort.length, secondShort: secondShort.length, secondNoShot: secondNoShot.length }) + '\n');
    // eslint-disable-next-line no-console
    console.log(`[soak] DONE cycles=${cycle} drops=${drops.length} fixtureShort=${fixtureShort.length} SOshort=${secondShort.length} SOnoShot=${secondNoShot.length}`);

    expect(cycle, 'should complete multiple cycles').toBeGreaterThan(0);
    // HARD GATE: the soak is about connection stability. Any cycle where a
    // browser was not 'live' is a real failure.
    expect(drops, `connection dropped / not-live in some cycles:\n${drops.join('\n')}`).toEqual([]);
    // SOFT gates (LLM/live-site variance): fail only on a PERSISTENT problem
    // (>20% of cycles), not isolated hiccups.
    const tol = Math.floor(cycle * 0.2);
    expect(fixtureShort.length, `fixture failed scroll/pagination/count (>=150 + scroll + page2) in too many cycles (${fixtureShort.length}/${cycle}):\n${fixtureShort.join('\n')}`).toBeLessThanOrEqual(tol);
    expect(secondShort.length, `Stack Overflow returned <15 questions in too many cycles (${secondShort.length}/${cycle}):\n${secondShort.join('\n')}`).toBeLessThanOrEqual(tol);
    expect(secondNoShot.length, `Stack Overflow screenshot missing in too many cycles (${secondNoShot.length}/${cycle}): ${secondNoShot.join(',')}`).toBeLessThanOrEqual(tol);
  });
});
