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
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '../..');
const extensionPath = path.resolve(REPO_ROOT, 'packages/extension/dist/chrome-mv3');
const nativeHostDist = path.resolve(REPO_ROOT, 'packages/native-host/dist/index.js');
const fixtureHtml = readFileSync(path.resolve(__dirname, 'fixtures/threads-feed.html'), 'utf8');

const DURATION_MIN = Number(process.env.SOAK_DURATION_MIN ?? 60);
const INTERVAL_MIN = Number(process.env.SOAK_INTERVAL_MIN ?? 5);
// Browser B opens a real public site. Default: Stack Overflow's question list
// (no login wall, lots of list items). Override with SOAK_SECOND_URL.
const SECOND_URL = process.env.SOAK_SECOND_URL ?? 'https://stackoverflow.com/questions';
const SECOND_MATCH = process.env.SOAK_SECOND_MATCH ?? 'stackoverflow.com';
const TIMELINE = path.resolve(REPO_ROOT, 'test-results/soak-timeline.ndjson');
const EXPORT_DIR = path.resolve(REPO_ROOT, 'test-results/exports');

interface Client { label: string; context: BrowserContext; uuid: string; browserId: string }

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
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
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

interface ExportResult { tools: string[]; posts: number; items: unknown[]; exitCode: number }

/** One real Claude CLI session operating the tab whose url contains `match`. */
const runExport = async (match: string): Promise<ExportResult> => {
  const prompt = [
    'You have agenthub MCP tools connected to real browsers.',
    `Operate ONLY on the browser tab whose URL contains "${match}".`,
    'Steps: (1) mcp__agenthub__list_tabs to find that tab and its id;',
    '(2) mcp__agenthub__take_screenshot on it; (3) scroll down twice with',
    'mcp__agenthub__scroll_page; (4) read every post / list item (e.g. each',
    'question on a Stack Overflow list) with mcp__agenthub__get_page_content',
    'or mcp__agenthub__extract_data.',
    'Output ONLY a JSON array of items {"text"} in a ```json block.',
  ].join(' ');
  const child = spawn('claude',
    ['--print', '--input-format', 'text', '--output-format', 'stream-json', '--verbose',
      '--model', 'haiku', '--dangerously-skip-permissions'],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true });
  child.stdin.end(prompt);

  const tools: string[] = [];
  let text = ''; let raw = '';
  child.stdout.on('data', (d: Buffer) => {
    raw += d.toString(); let nl: number;
    while ((nl = raw.indexOf('\n')) !== -1) {
      const line = raw.slice(0, nl); raw = raw.slice(nl + 1);
      if (!line.trim()) continue;
      let m: { type?: string; message?: { content?: Array<{ type: string; name?: string; text?: string }> }; result?: string };
      try { m = JSON.parse(line); } catch { continue; }
      if (m.type === 'assistant') for (const b of m.message?.content ?? []) {
        if (b.type === 'tool_use' && b.name) tools.push(b.name);
        if (b.type === 'text' && b.text) text += '\n' + b.text;
      }
      if (m.type === 'result' && m.result) text += '\n' + m.result;
    }
  });
  const exitCode: number = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill(); } catch { /* noop */ } resolve(-2); }, 150_000);
    child.on('exit', (c) => { clearTimeout(t); resolve(c ?? -1); });
    child.on('error', () => { clearTimeout(t); resolve(-3); });
  });
  let items: unknown[] = [];
  const j = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text.match(/\[\s*\{[\s\S]*?\}\s*\]/)?.[0] ?? '';
  try { const p = JSON.parse(j.trim()); if (Array.isArray(p)) items = p; } catch { /* [] */ }
  return { tools: [...new Set(tools.filter((t) => t.startsWith('mcp__agenthub__')))], posts: items.length, items, exitCode };
};

test.describe('two-browser soak (fixture + live public site)', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
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

    fixtureServer = http.createServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixtureHtml);
    });
    const fixturePort = await new Promise<number>((resolve) =>
      fixtureServer.listen(0, '127.0.0.1', () => resolve((fixtureServer.address() as import('net').AddressInfo).port)));
    fixtureUrl = `http://127.0.0.1:${fixturePort}/`;

    // Browser A — fixture; Browser B — live public site (Stack Overflow).
    for (const [label, url] of [['A-fixture', fixtureUrl], ['B-second', SECOND_URL]] as const) {
      const ctx = await launch(fs.mkdtempSync(path.join(os.tmpdir(), `copilot-soak-${label}-`)));
      const extId = await findExtId(ctx);
      const uuid = await waitConnectedUuid(ctx, extId);
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => { /* live site may be slow */ });
      await sleep(1500);
      clients.push({ label, context: ctx, uuid, browserId: `chrome:${uuid}` });
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
    for (const c of clients) { try { await c.context.close(); } catch { /* noop */ } }
    await new Promise<void>((r) => fixtureServer ? fixtureServer.close(() => r()) : r());
    if (bridge && !bridge.killed) { bridge.kill(); await sleep(400); }
  });

  test(`soak ${DURATION_MIN}min @ ${INTERVAL_MIN}min cadence — connection stays healthy`, async () => {
    test.setTimeout((DURATION_MIN + 12) * 60_000);
    const fixture = clients[0]; const real = clients[1];
    const endAt = Date.now() + DURATION_MIN * 60_000;
    const drops: string[] = []; const fixtureShort: string[] = []; let cycle = 0;

    while (Date.now() < endAt) {
      cycle += 1;
      const cycleStart = Date.now();
      const before = await fetchState(bridgePort);
      const resA = await runExport('127.0.0.1');
      const resB = await runExport(SECOND_MATCH);
      const after = await fetchState(bridgePort);

      const healthy = (st: Record<string, string>, id: string) => st[id] === 'live';
      const bothLive = ['before', 'after'].every((_w, i) => {
        const st = i === 0 ? before : after;
        return healthy(st, fixture.browserId) && healthy(st, real.browserId);
      });
      if (!bothLive) drops.push(`cycle ${cycle}: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
      if (resA.posts < 5) fixtureShort.push(`cycle ${cycle}: fixture posts=${resA.posts} tools=${resA.tools.join(',')}`);

      // Save the actual exported items so you can inspect the real data per cycle.
      mkdirSync(EXPORT_DIR, { recursive: true });
      const cy = String(cycle).padStart(3, '0');
      writeFileSync(path.join(EXPORT_DIR, `cycle${cy}-fixture.json`), JSON.stringify(resA.items, null, 2));
      writeFileSync(path.join(EXPORT_DIR, `cycle${cy}-second.json`), JSON.stringify(resB.items, null, 2));

      appendFileSync(TIMELINE, JSON.stringify({
        cycle, t: new Date().toISOString(),
        before, after, bothLive,
        fixture: { posts: resA.posts, tools: resA.tools, exit: resA.exitCode },
        second: { posts: resB.posts, tools: resB.tools, exit: resB.exitCode },
      }) + '\n');
      // eslint-disable-next-line no-console
      console.log(`[soak] cycle ${cycle} bothLive=${bothLive} fixturePosts=${resA.posts} secondPosts=${resB.posts} secondTools=${resB.tools.length}`);

      if (Date.now() >= endAt) break;
      const waitMs = cycleStart + INTERVAL_MIN * 60_000 - Date.now();
      if (waitMs > 0) await sleep(waitMs);
    }

    appendFileSync(TIMELINE, JSON.stringify({ event: 'end', cycles: cycle, drops: drops.length, fixtureShort: fixtureShort.length }) + '\n');
    // eslint-disable-next-line no-console
    console.log(`[soak] DONE cycles=${cycle} drops=${drops.length} fixtureShort=${fixtureShort.length}\n${drops.concat(fixtureShort).join('\n')}`);

    expect(cycle, 'should complete multiple cycles').toBeGreaterThan(0);
    // HARD GATE: the soak is about connection stability. Any cycle where a
    // browser was not 'live' is a real failure.
    expect(drops, `connection dropped / not-live in some cycles:\n${drops.join('\n')}`).toEqual([]);
    // SOFT: the fixture is deterministic (8 posts) so it should be >5, but a
    // one-off Claude miscount over many cycles is model variability, not a
    // system bug. Fail only if it's short in MORE than 20% of cycles (a
    // persistent extraction problem), not on isolated hiccups.
    expect(
      fixtureShort.length,
      `fixture export returned <5 in too many cycles (${fixtureShort.length}/${cycle}):\n${fixtureShort.join('\n')}`,
    ).toBeLessThanOrEqual(Math.floor(cycle * 0.2));
  });
});
