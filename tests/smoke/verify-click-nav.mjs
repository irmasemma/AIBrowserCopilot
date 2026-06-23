#!/usr/bin/env node
/**
 * One-off live verifier for the click_element navigating-click fix.
 * Connects to the live bridge over role=mcp, navigates a tab to example.com,
 * snapshots to find the "More information" link, clicks it (which NAVIGATES),
 * and checks the click returns success FAST (not the old ~16-18s error) with a
 * fresh snapshot. Reuses the smoke MCP-over-WS client.
 */
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const port = (() => { try { return JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'agenthub', 'server.lock'), 'utf-8')).port; } catch { return 7483; } })();

function mcp() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?role=mcp`);
    const pending = new Map(); let id = 1;
    ws.on('message', (d) => { for (const l of String(d).split('\n')) { const t = l.trim(); if (!t) continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } } });
    ws.on('error', reject);
    ws.on('open', async () => {
      const rpc = (method, params, ms = 20000) => new Promise((res, rej) => { const i = id++; const timer = setTimeout(() => { pending.delete(i); rej(new Error(`${method} timeout`)); }, ms); pending.set(i, { resolve: res, reject: rej, timer }); ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params })); });
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-click', version: '1' } }, 8000);
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      resolve({ call: (n, a, ms) => rpc('tools/call', { name: n, arguments: a }, ms), close: () => ws.close() });
    });
  });
}
const txt = (r) => (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

const m = await mcp();
try {
  const lt = await m.call('list_tabs', {}, 8000);
  const tabs = JSON.parse(txt(lt));
  const tab = (Array.isArray(tabs) ? tabs : tabs.tabs).find((t) => /^https?:/.test(t.url)) ?? (Array.isArray(tabs) ? tabs : tabs.tabs)[0];
  console.log('using tab', tab.id, tab.url);

  await m.call('navigate', { tab_id: tab.id, url: 'https://example.com' }, 15000);
  await new Promise((r) => setTimeout(r, 1500));

  const snap = await m.call('get_page_content', { tab_id: tab.id }, 8000); // warm
  console.log('on example.com, content has "Example Domain":', /example domain/i.test(txt(snap)));

  // Click the "More information..." link (navigates to iana.org) by text.
  const t0 = Date.now();
  let res, err = null;
  try { res = await m.call('click_element', { tab_id: tab.id, selector: 'a' }, 20000); }
  catch (e) { err = e.message; }
  const dur = Date.now() - t0;

  console.log(`\nclick (navigating) took ${dur}ms`);
  if (err) { console.log('RESULT: ERROR —', err); process.exit(1); }
  const body = txt(res);
  const ok = /"success":\s*true/.test(body);
  // A navigating click returns either a fresh snapshot OR an explicit
  // "still loading" note — both are correct; a SILENT empty snapshot is not.
  const hasSnap = /Page Snapshot/.test(body);
  const realRefs = /Interactive elements/.test(body);
  console.log('success:', ok, '| snapshot-or-note present:', hasSnap, '| real refs:', realRefs);

  // Post-navigation playwright op must work (gap #1 + the screenshot-after-nav
  // hang). If the click left the page settled, a screenshot of the navigated
  // page returns fast; if the page is in flux it hangs (the old symptom).
  const ts = Date.now();
  let shotOk = false, shotErr = null;
  try { const s = await m.call('take_screenshot', { tab_id: tab.id, format: 'jpeg' }, 15000); shotOk = (s?.content?.find((c) => c.type === 'image')?.data?.length ?? 0) > 1000; }
  catch (e) { shotErr = e.message; }
  console.log(`post-nav screenshot took ${Date.now() - ts}ms — ${shotOk ? 'OK' : `FAIL (${shotErr ?? 'too small'})`}`);

  const pass = ok && dur < 12000 && hasSnap && shotOk;
  console.log(pass ? '\nPASS: navigating click → success fast, fresh snapshot, page usable for next op' : '\nCHECK: see above (a sub-check failed)');
  process.exit(pass ? 0 : 1);
} finally { m.close(); }
