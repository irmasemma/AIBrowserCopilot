#!/usr/bin/env node
/**
 * AgentHub real smoke test — exercises the ACTUAL production tool path.
 *
 * Connects to the live bridge as an MCP client (the same `?role=mcp` path
 * Claude Code / Cursor use) and runs real tool round-trips against the real
 * extension + real Chrome:
 *
 *   list_tabs → get_page_content → take_screenshot   (read-only, default)
 *   + navigate https://example.com → verify content  (--full, destructive)
 *
 * WHY this and not the diagnostics panel: per RCA 2026-06-18 (green-but-zero-
 * tabs), "connected/all-green" only measures BRIDGE-side facts. The only true
 * health signal is a tool round-trip through the extension's CURRENT socket. A
 * wedged/orphaned socket still pongs (green) while every tool times out at
 * ~10s and returns empty. This test measures that round-trip and its LATENCY:
 * a healthy fan-out returns in tens of ms; ~10s == FAN_OUT_TIMEOUT == wedge.
 *
 * On ANY failure it writes a timestamped report to tests/smoke/reports/ with
 * the failure detail + /api/state + tails of bridge/extension/helper logs.
 *
 * Usage:
 *   node tests/smoke/smoke.mjs                 # one run, exit 0/1
 *   node tests/smoke/smoke.mjs --full          # also navigate + verify content
 *   node tests/smoke/smoke.mjs --loop 300      # run every 300s forever
 */
import { WebSocket } from 'ws';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dir, 'reports');

// ── config / thresholds ────────────────────────────────────────────────────
const LIST_TABS_WEDGE_MS = 3000;   // > this on list_tabs == suspect orphan wedge
const TOOL_TIMEOUT_MS = 12000;     // hard ceiling per tool (bridge fan-out is 10s)
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const loopIdx = args.indexOf('--loop');
const LOOP_SECONDS = loopIdx !== -1 ? Number(args[loopIdx + 1]) : 0;

function installDir() {
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'agenthub');
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'agenthub');
  return join(homedir(), '.local', 'share', 'agenthub');
}
function bridgePort() {
  if (process.env.AGENTHUB_SMOKE_PORT) return Number(process.env.AGENTHUB_SMOKE_PORT);
  try {
    const lock = JSON.parse(readFileSync(join(installDir(), 'server.lock'), 'utf-8'));
    if (typeof lock.port === 'number') return lock.port;
  } catch { /* fall through */ }
  return 7483;
}
function tailLog(name, n = 80) {
  try {
    const lines = readFileSync(join(installDir(), 'logs', name), 'utf-8').trimEnd().split('\n');
    return lines.slice(-n).join('\n');
  } catch (e) { return `(could not read ${name}: ${e.message})`; }
}
async function apiState(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/state`);
    return JSON.stringify(await r.json(), null, 2);
  } catch (e) { return `(/api/state unreachable: ${e.message})`; }
}

// ── minimal MCP-over-WS client ──────────────────────────────────────────────
function connectMcp(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
    const pending = new Map(); // id -> {resolve,reject,timer}
    let nextId = 1;
    ws.on('message', (data) => {
      for (const line of data.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg; try { msg = JSON.parse(t); } catch { continue; }
        if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      }
    });
    ws.on('error', reject);
    ws.on('open', async () => {
      const rpc = (method, params, timeoutMs = TOOL_TIMEOUT_MS) => new Promise((res, rej) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`rpc '${method}' timed out after ${timeoutMs}ms`)); }, timeoutMs);
        pending.set(id, { resolve: res, reject: rej, timer });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
      try {
        await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agenthub-smoke', version: '1' } }, 8000);
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
        resolve({
          callTool: (name, arguments_, timeoutMs) => rpc('tools/call', { name, arguments: arguments_ }, timeoutMs),
          close: () => { try { ws.close(); } catch { /* */ } },
        });
      } catch (e) { reject(e); }
    });
  });
}

// Pull the first content text / image out of an MCP tool result.
function resultText(result) {
  const c = result?.content?.find((x) => x.type === 'text');
  return c?.text ?? '';
}
function resultImage(result) {
  return result?.content?.find((x) => x.type === 'image') ?? null;
}

// ── one smoke run ───────────────────────────────────────────────────────────
async function runOnce() {
  const port = bridgePort();
  const failures = [];
  const note = (scenario, detail, extra = {}) => failures.push({ scenario, detail, ...extra });
  let mcp;
  try {
    mcp = await connectMcp(port);
  } catch (e) {
    note('connect', `Could not open MCP connection to bridge on :${port} — ${e.message}`);
    await writeReportIfFailed(port, failures);
    return failures;
  }

  let firstTabId = null;
  try {
    // 1) list_tabs — round-trip + latency (the wedge detector).
    let t0 = Date.now();
    let res;
    try { res = await mcp.callTool('list_tabs', {}); }
    catch (e) { note('list_tabs', `tool call failed: ${e.message}`, { durationMs: Date.now() - t0 }); res = null; }
    if (res) {
      const dur = Date.now() - t0;
      let tabs = [];
      try { const j = JSON.parse(resultText(res)); tabs = Array.isArray(j) ? j : (j.tabs ?? []); } catch { /* */ }
      const isError = res.isError === true;
      if (dur > LIST_TABS_WEDGE_MS && tabs.length === 0) {
        note('list_tabs', `Returned ${tabs.length} tabs in ${dur}ms — ORPHAN-SOCKET WEDGE (green-but-zero-tabs, RCA 2026-06-18). ~10s + empty == the extension socket never answered.`, { durationMs: dur });
      } else if (isError || tabs.length === 0) {
        note('list_tabs', `Returned 0 tabs (isError=${isError}) in ${dur}ms. Either no browser is connected/has tabs, or the tool path is broken.`, { durationMs: dur });
      } else {
        // pick the first http(s) tab for the read-only checks
        const httpTab = tabs.find((x) => typeof x.url === 'string' && /^https?:/.test(x.url)) ?? tabs[0];
        firstTabId = httpTab?.id ?? null;
        process.stdout.write(`  list_tabs: ${tabs.length} tabs in ${dur}ms ✓\n`);
      }
    }

    // 2) optional destructive: navigate a tab to example.com and verify content.
    if (FULL && firstTabId) {
      let t = Date.now();
      try {
        await mcp.callTool('navigate', { tab_id: firstTabId, url: 'https://example.com' }, TOOL_TIMEOUT_MS);
        await new Promise((r) => setTimeout(r, 1200));
        const c = await mcp.callTool('get_page_content', { tab_id: firstTabId });
        const text = resultText(c);
        if (!/example domain/i.test(text)) note('navigate+content', `Navigated to example.com but content did not contain "Example Domain" (got ${text.length} chars).`, { durationMs: Date.now() - t });
        else process.stdout.write(`  navigate+content: example.com verified in ${Date.now() - t}ms ✓\n`);
      } catch (e) { note('navigate+content', `failed: ${e.message}`, { durationMs: Date.now() - t }); }

      // NOTE: the navigating-click regression check lives in the dedicated
      // verify-click-nav.mjs (it leaves the tab mid-navigation, which would
      // cascade into the read-only checks below). Keep it separate.
    }

    // 3) get_page_content (read-only) on whatever's open.
    if (firstTabId) {
      let t = Date.now();
      try {
        const c = await mcp.callTool('get_page_content', { tab_id: firstTabId });
        const text = resultText(c);
        if (!text || text.length < 1) note('get_page_content', `Returned empty content in ${Date.now() - t}ms.`, { durationMs: Date.now() - t });
        else process.stdout.write(`  get_page_content: ${text.length} chars in ${Date.now() - t}ms ✓\n`);
      } catch (e) { note('get_page_content', `failed: ${e.message}`, { durationMs: Date.now() - t }); }

      // 4) take_screenshot (read-only) — would hang pre-v0.5.13 (captureVisibleTab).
      t = Date.now();
      try {
        const s = await mcp.callTool('take_screenshot', { tab_id: firstTabId, format: 'jpeg' });
        const img = resultImage(s);
        if (!img || !img.data || img.data.length < 1000) note('take_screenshot', `Returned no/too-small image (${img?.data?.length ?? 0} b64 chars) in ${Date.now() - t}ms.`, { durationMs: Date.now() - t });
        else process.stdout.write(`  take_screenshot: ${img.data.length} b64 chars in ${Date.now() - t}ms ✓\n`);
      } catch (e) { note('take_screenshot', `failed: ${e.message}`, { durationMs: Date.now() - t }); }
    }
  } finally {
    mcp?.close();
  }

  await writeReportIfFailed(port, failures);
  return failures;
}

async function writeReportIfFailed(port, failures) {
  if (failures.length === 0) return;
  mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(REPORTS_DIR, `${ts}-smoke-fail.md`);
  const body = [
    `# AgentHub smoke FAILURE — ${new Date().toISOString()}`,
    ``,
    `Bridge port: ${port}`,
    ``,
    `## Failures`,
    ...failures.map((f) => `- **${f.scenario}**${f.durationMs != null ? ` (${f.durationMs}ms)` : ''}: ${f.detail}`),
    ``,
    `## /api/state`,
    '```json',
    await apiState(port),
    '```',
    ``,
    `## bridge.log (tail)`,
    '```',
    tailLog('bridge.log'),
    '```',
    ``,
    `## extension.log (tail)`,
    '```',
    tailLog('extension.log'),
    '```',
    ``,
    `## helper.log (tail)`,
    '```',
    tailLog('helper.log', 40),
    '```',
    ``,
  ].join('\n');
  writeFileSync(file, body, 'utf-8');
  process.stdout.write(`  ✗ report written: ${file}\n`);
}

// ── entry ───────────────────────────────────────────────────────────────────
async function main() {
  if (LOOP_SECONDS > 0) {
    process.stdout.write(`smoke loop every ${LOOP_SECONDS}s (reports on failure only). Ctrl-C to stop.\n`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ts = new Date().toLocaleTimeString();
      const failures = await runOnce();
      process.stdout.write(`[${ts}] ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}\n`);
      await new Promise((r) => setTimeout(r, LOOP_SECONDS * 1000));
    }
  } else {
    const failures = await runOnce();
    if (failures.length === 0) { process.stdout.write('SMOKE PASS\n'); process.exit(0); }
    else { process.stdout.write(`SMOKE FAIL (${failures.length})\n`); process.exit(1); }
  }
}
main().catch((e) => { process.stderr.write(`smoke crashed: ${e.stack}\n`); process.exit(2); });
