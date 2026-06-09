/**
 * Embedded diagnostics page.
 *
 * Served from the bridge HTTP server at `GET /`. Single self-contained HTML
 * file — no external CDN dependencies, no build step. Polls `/api/state`
 * every 1.5 s and renders four component cards, a recent-activity timeline,
 * a tabbed logs viewer, and action buttons (Restart Bridge, Reload Extension,
 * Clear Logs Privacy Toggle).
 *
 * Design goals (12-year-old friendly):
 *   - Plain English labels ("Your AI Assistant", "Bridge", "Browser Extension")
 *   - Traffic-light colors (green / yellow / red / gray)
 *   - Connection arrows showing data flow direction
 *   - Recent activity in plain words ("Took screenshot of chrome — succeeded in 245ms")
 *   - One screen, no scrolling needed for the headline status view
 *   - All tech detail tucked behind "Show details" toggles
 *
 * Why embed as a TS string instead of a separate .html file:
 *   The bridge ships as a single pkg-compiled .exe with no asset bundle. A
 *   sibling .html file would be missed by pkg. Embedding the HTML as a
 *   template string puts it inside the bundle automatically. ~30 KB.
 */

export const DIAG_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentHub — Health</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
  body { padding: 24px; max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 700; }
  h1 .emoji { font-size: 26px; }
  .subtitle { color: #64748b; font-size: 14px; margin: 0 0 24px; }
  .row-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .pill { background: #e2e8f0; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #475569; }
  .pill.live { background: #dcfce7; color: #166534; }
  .pill.live::before { content: '● '; color: #16a34a; animation: blink 2s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.4; } }

  /* ── Component flow ─── */
  .flow { display: grid; grid-template-columns: 1fr 56px 1fr 56px 1fr 56px 1fr; gap: 0; align-items: stretch; margin: 24px 0; }
  .card { background: white; border-radius: 16px; padding: 20px 18px; border: 2px solid #e2e8f0; display: flex; flex-direction: column; min-height: 180px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.15s ease; }
  .card.ok { border-color: #86efac; background: #f0fdf4; }
  .card.warn { border-color: #fcd34d; background: #fefce8; }
  .card.bad { border-color: #fca5a5; background: #fef2f2; }
  .card.idle { border-color: #cbd5e1; background: #f1f5f9; }
  .card-emoji { font-size: 36px; line-height: 1; margin-bottom: 12px; }
  .card-title { font-weight: 600; font-size: 15px; margin: 0; }
  .card-subtitle { color: #64748b; font-size: 12px; margin: 2px 0 12px; }
  .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; align-self: flex-start; }
  .status-badge.ok { background: #86efac; color: #052e16; }
  .status-badge.warn { background: #fcd34d; color: #422006; }
  .status-badge.bad { background: #fca5a5; color: #450a0a; }
  .status-badge.idle { background: #cbd5e1; color: #1e293b; }
  .card-meta { margin-top: auto; font-size: 12px; color: #64748b; padding-top: 8px; line-height: 1.5; }
  .card-meta b { color: #0f172a; font-weight: 500; }
  .card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .btn { background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; color: #0f172a; font-weight: 500; transition: all 0.15s; }
  .btn:hover { background: #f1f5f9; border-color: #94a3b8; }
  .btn.primary { background: #3b82f6; border-color: #2563eb; color: white; }
  .btn.primary:hover { background: #2563eb; }
  .btn.danger { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
  .btn.danger:hover { background: #fecaca; }

  /* Connection arrows between cards */
  .arrow { display: flex; align-items: center; justify-content: center; position: relative; }
  .arrow-line { position: relative; width: 100%; height: 2px; background: #cbd5e1; }
  .arrow-line::after { content: ''; position: absolute; right: -1px; top: -5px; border-left: 8px solid #cbd5e1; border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
  .arrow.ok .arrow-line { background: #16a34a; }
  .arrow.ok .arrow-line::after { border-left-color: #16a34a; }
  .arrow.bad .arrow-line { background: #dc2626; }
  .arrow.bad .arrow-line::after { border-left-color: #dc2626; }
  .arrow-label { position: absolute; top: -22px; font-size: 11px; color: #64748b; white-space: nowrap; }

  /* ── Recent activity ─── */
  .activity { background: white; border-radius: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
  .section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
  .activity-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
  .activity-empty { color: #94a3b8; font-style: italic; padding: 16px 0; text-align: center; }
  .activity-row { display: grid; grid-template-columns: 80px 36px 1fr auto auto; gap: 12px; align-items: center; padding: 8px 12px; border-radius: 8px; background: #f8fafc; font-size: 13px; }
  .activity-row.success { background: #f0fdf4; }
  .activity-row.error { background: #fef2f2; }
  .activity-row.pending { background: #fefce8; }
  .activity-time { color: #94a3b8; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; }
  .activity-emoji { font-size: 18px; }
  .activity-desc { color: #0f172a; }
  .activity-desc b { font-weight: 600; }
  .activity-target { color: #64748b; font-size: 12px; padding: 2px 8px; background: #e2e8f0; border-radius: 6px; }
  .activity-dur { color: #475569; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; }

  /* ── Logs viewer ─── */
  .logs { background: white; border-radius: 16px; padding: 20px; border: 1px solid #e2e8f0; }
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
  .tab { padding: 8px 16px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: #64748b; font-weight: 500; border-bottom: 2px solid transparent; }
  .tab.active { color: #2563eb; border-bottom-color: #2563eb; }
  .tab .count { background: #e2e8f0; color: #475569; padding: 1px 8px; border-radius: 10px; font-size: 11px; margin-left: 6px; }
  .tab.active .count { background: #dbeafe; color: #1e40af; }
  .logs-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .logs-search { flex: 1; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: inherit; }
  .logs-view { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; max-height: 360px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; line-height: 1.5; }
  .logs-view .lvl-info { color: #93c5fd; }
  .logs-view .lvl-warn { color: #fcd34d; }
  .logs-view .lvl-error { color: #fca5a5; }
  .logs-view .ev { color: #c4b5fd; font-weight: 600; }
  .logs-view .t { color: #64748b; }
  .logs-empty { color: #94a3b8; font-style: italic; padding: 24px; text-align: center; }

  /* ── Toast ─── */
  .toast { position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 12px 20px; border-radius: 12px; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.error { background: #991b1b; }

  /* ── Responsive (narrow window) ─── */
  @media (max-width: 1024px) {
    .flow { grid-template-columns: 1fr; grid-template-rows: auto; }
    .arrow { transform: rotate(90deg); height: 30px; margin: 0 auto; width: 40px; }
  }

  /* ── Help banner ─── */
  .banner { background: #dbeafe; border: 1px solid #93c5fd; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; color: #1e40af; font-size: 13px; }
  .banner b { font-weight: 600; }

  details { font-size: 12px; color: #475569; margin-top: 6px; }
  details summary { cursor: pointer; color: #64748b; }
  details code { font-family: ui-monospace, "Cascadia Code", monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }

  /* ── Interactive item lists (MCP clients, browsers) ─── */
  .item-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .item-empty { color: #64748b; font-size: 12px; font-style: italic; padding: 6px 0; }
  .item {
    background: rgba(255,255,255,0.6); border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 8px 10px; font-size: 12px; cursor: pointer; transition: all 0.12s;
    display: flex; align-items: center; gap: 8px;
    text-align: left; width: 100%; font-family: inherit; color: inherit;
  }
  .item:hover { border-color: #93c5fd; background: white; }
  .item:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
  .item.expanded { background: white; border-color: #3b82f6; }
  .item-emoji { font-size: 14px; flex-shrink: 0; }
  .item-main { flex: 1; min-width: 0; overflow: hidden; }
  .item-main b { display: block; color: #0f172a; font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-main .item-sub { color: #64748b; font-size: 11px; }
  .item-count { font-size: 10px; color: #475569; background: #e2e8f0; padding: 2px 7px; border-radius: 999px; font-weight: 600; flex-shrink: 0; }
  .item.expanded .item-count { background: #dbeafe; color: #1e40af; }
  .item-caret { color: #94a3b8; transition: transform 0.15s; flex-shrink: 0; }
  .item.expanded .item-caret { transform: rotate(90deg); color: #3b82f6; }
  .item-detail {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 10px 12px; font-size: 11px; color: #475569; margin-top: -2px;
    font-family: ui-monospace, "Cascadia Code", monospace; line-height: 1.6;
  }
  .item-detail .row { display: flex; gap: 8px; margin-bottom: 4px; }
  .item-detail .row:last-child { margin-bottom: 0; }
  .item-detail .label { color: #94a3b8; min-width: 90px; flex-shrink: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; }
  .item-detail .val { color: #0f172a; word-break: break-all; }
  .item-detail .recent-mini {
    margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .item-detail .recent-mini .mini-title { font-weight: 600; font-size: 11px; color: #475569; margin-bottom: 4px; }
  .item-detail .recent-mini .mini-row { font-size: 11px; color: #64748b; padding: 2px 0; }
  .item-detail .recent-mini .mini-row .mini-emoji { margin-right: 4px; }
</style>
</head>
<body>
  <div class="row-top">
    <div>
      <h1><span class="emoji">🌐</span> AgentHub Health</h1>
      <p class="subtitle">What's running, what's talking to what, and how to fix it if something's stuck.</p>
    </div>
    <span class="pill live" id="livePill">Updating live</span>
  </div>

  <div class="banner" id="banner" style="display:none">
    <b>Heads up:</b> <span id="bannerMsg"></span>
  </div>

  <!-- ── Component flow ── -->
  <div class="flow" id="flow">
    <!-- 4 cards + 3 arrows interleaved, populated by JS -->
    <div class="card idle" id="card-mcp">
      <div class="card-emoji">💬</div>
      <p class="card-title">Your AI Assistant</p>
      <p class="card-subtitle">Claude, Cursor, VS Code…</p>
      <span class="status-badge idle">Loading…</span>
      <div class="card-meta" id="mcp-meta">—</div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">MCP requests</span></div></div>
    <div class="card idle" id="card-bridge">
      <div class="card-emoji">🌉</div>
      <p class="card-title">Bridge</p>
      <p class="card-subtitle">Connects everything</p>
      <span class="status-badge idle">Loading…</span>
      <div class="card-meta" id="bridge-meta">—</div>
      <div class="card-actions">
        <button class="btn primary" onclick="action('restart-bridge')">Restart</button>
      </div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">WebSocket</span></div></div>
    <div class="card idle" id="card-ext">
      <div class="card-emoji">🧩</div>
      <p class="card-title">Browser Extension</p>
      <p class="card-subtitle">Inside Chrome / Edge</p>
      <span class="status-badge idle">Loading…</span>
      <div class="card-meta" id="ext-meta">—</div>
      <div class="card-actions">
        <button class="btn" onclick="action('reload-extension')">Reload</button>
      </div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">Chrome tabs</span></div></div>
    <div class="card idle" id="card-browser">
      <div class="card-emoji">🌍</div>
      <p class="card-title">Browser Tabs</p>
      <p class="card-subtitle">Where the work happens</p>
      <span class="status-badge idle">Loading…</span>
      <div class="card-meta" id="browser-meta">—</div>
    </div>
  </div>

  <!-- ── Recent activity ── -->
  <div class="activity">
    <p class="section-title">📊 Recent Activity <span class="pill" id="activity-count">0 actions</span></p>
    <div class="activity-list" id="activity-list">
      <div class="activity-empty">No activity yet. Try asking your AI assistant to do something.</div>
    </div>
  </div>

  <!-- ── Logs ── -->
  <div class="logs">
    <p class="section-title">📜 Logs</p>
    <div class="tabs">
      <button class="tab active" data-tab="bridge" onclick="switchTab('bridge')">Bridge <span class="count" id="count-bridge">—</span></button>
      <button class="tab" data-tab="extension" onclick="switchTab('extension')">Extension <span class="count" id="count-extension">—</span></button>
      <button class="tab" data-tab="helper" onclick="switchTab('helper')">Helper <span class="count" id="count-helper">—</span></button>
    </div>
    <div class="logs-controls">
      <input class="logs-search" id="logs-search" placeholder="Filter (e.g. tools_call, error, mcpId)…" oninput="renderLogs()">
      <button class="btn" onclick="loadLogs()">Refresh</button>
    </div>
    <div class="logs-view" id="logs-view">
      <div class="logs-empty">Loading…</div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
"use strict";
const POLL_MS = 1500;
let state = { state: null, logs: { bridge: [], extension: [], helper: [] }, currentTab: 'bridge', openItems: new Set() };

// ── Utilities ──────────────────────────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtRelTime(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
  return Math.floor(ms / 3600000) + 'h ago';
}
function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => el.className = 'toast' + (isError ? ' error' : ''), 3500);
}
function setStatus(cardId, status, label) {
  const card = document.getElementById('card-' + cardId);
  card.classList.remove('ok', 'warn', 'bad', 'idle');
  card.classList.add(status);
  const badge = card.querySelector('.status-badge');
  badge.className = 'status-badge ' + status;
  badge.textContent = label;
}
function setArrow(idx, status) {
  const arrows = document.querySelectorAll('.arrow');
  const a = arrows[idx];
  if (!a) return;
  a.classList.remove('ok', 'bad');
  if (status) a.classList.add(status);
}

// ── Polling /api/state ─────────────────────────────────────────────────
async function poll() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.state = await r.json();
    render();
  } catch (err) {
    document.getElementById('livePill').textContent = 'Offline — bridge not responding';
    document.getElementById('livePill').classList.remove('live');
    setStatus('bridge', 'bad', 'Off');
    setStatus('ext', 'idle', 'Unknown');
    setStatus('browser', 'idle', 'Unknown');
    setStatus('mcp', 'idle', 'Unknown');
  }
}

function render() {
  const s = state.state;
  if (!s) return;
  // Bridge
  setStatus('bridge', 'ok', 'On — v' + s.bridge.version);
  document.getElementById('bridge-meta').innerHTML =
    '<b>Port:</b> ' + s.bridge.port + ' &nbsp; <b>PID:</b> ' + s.bridge.pid + '<br><b>Up:</b> ' + fmtUptime(s.bridge.uptimeSec) +
    '<details><summary>More</summary>Build: ' + esc(s.bridge.buildId) + '<br>Started by: ' + esc(s.bridge.startedBy) + '<br>Allowlist: ' + s.bridge.allowedExtensionIdsCount + ' ID(s)</details>';

  // MCP clients — interactive list (click to expand details)
  const mcpCount = s.mcpClients.length;
  setStatus('mcp', mcpCount > 0 ? 'ok' : 'idle', mcpCount + ' connected');
  document.getElementById('mcp-meta').innerHTML = mcpCount === 0
    ? '<div class="item-empty">No AI assistant connected yet.</div>'
      + '<details><summary>How to connect</summary>Configure Claude / Cursor / VS Code with MCP server <code>agenthub</code>.</details>'
    : '<div class="item-list">' + s.mcpClients.map((c, i) =>
        renderClientItem(c, i, s.recentRequests || [])
      ).join('') + '</div>';

  // Extension card — count summary (the per-browser detail lives on the next card)
  const extCount = s.browsers.length;
  setStatus('ext', extCount > 0 ? 'ok' : 'bad', extCount > 0 ? 'On' : 'Not connected');
  document.getElementById('ext-meta').innerHTML = extCount === 0
    ? '<div class="item-empty">No browser extension connected.</div>'
      + '<details><summary>How to fix</summary>1. Open Chrome / Edge<br>2. Open the AgentHub side panel<br>3. Wait ~5 seconds</details>'
    : '<b>' + extCount + '</b> browser' + (extCount === 1 ? '' : 's') + ' connected — see next →';

  // Browsers — interactive list (click to expand details)
  setStatus('browser', extCount > 0 ? 'ok' : 'idle', extCount === 0 ? 'No browsers' : extCount + ' browser' + (extCount === 1 ? '' : 's'));
  document.getElementById('browser-meta').innerHTML = s.browsers.length === 0
    ? '<div class="item-empty">No browsers yet.</div>'
    : '<div class="item-list">' + s.browsers.map((b, i) =>
        renderBrowserItem(b, i, s.recentRequests || [])
      ).join('') + '</div>';

  // Arrows
  setArrow(0, mcpCount > 0 ? 'ok' : null);
  setArrow(1, extCount > 0 ? 'ok' : 'bad');
  setArrow(2, extCount > 0 ? 'ok' : null);

  // Banner: surface common problems
  let banner = null;
  if (extCount === 0 && s.recentRejections.length > 0) {
    banner = 'Your browser extension is trying to connect but the bridge is rejecting it. The extension ID isn\\'t allowlisted. Run <code>npx agenthub-setup --extension-id &lt;your-id&gt;</code>.';
  } else if (extCount === 0) {
    banner = 'No browser extension connected. Open the AgentHub side panel in Chrome or Edge.';
  } else if (mcpCount === 0) {
    banner = 'No AI assistant has connected yet. The bridge and extension are ready when you are.';
  }
  if (banner) {
    document.getElementById('banner').style.display = 'block';
    document.getElementById('bannerMsg').innerHTML = banner;
  } else {
    document.getElementById('banner').style.display = 'none';
  }

  // Activity timeline
  renderActivity(s.recentRequests || []);

  // Restore any item-detail panels the user had opened before the poll.
  reapplyOpenItems();
}

// ── Friendly name resolution for MCP clients ──────────────────────────
function mcpClientFriendlyName(c) {
  if (c.clientInfo && c.clientInfo.name) {
    return c.clientInfo.name + (c.clientInfo.version ? ' v' + c.clientInfo.version : '');
  }
  // stdio: the MCP-over-stdio attached client (likely the bridge's own
  // stdio if launched from a config); show transport prominently
  if (c.transport === 'stdio') return 'Stdio MCP client';
  // ws: a Node MCP child (like the VS Code helper); show short id
  return 'MCP client ' + (c.clientId || '').slice(0, 8) + '…';
}
function mcpClientEmoji(c) {
  const name = ((c.clientInfo && c.clientInfo.name) || '').toLowerCase();
  if (name.includes('claude')) return '🤖';
  if (name.includes('cursor')) return '🟠';
  if (name.includes('vscode') || name.includes('vs code') || name.includes('copilot')) return '🟦';
  if (name.includes('zed')) return '⚡';
  return c.transport === 'stdio' ? '⌨️' : '🔌';
}
function browserBrandEmoji(brand) {
  if (brand === 'chrome') return '🟢';
  if (brand === 'edge') return '🔷';
  if (brand === 'brave') return '🦁';
  if (brand === 'arc') return '🌈';
  if (brand === 'vivaldi') return '🟥';
  return '🌐';
}

function renderClientItem(c, i, requests) {
  const friendly = mcpClientFriendlyName(c);
  const emoji = mcpClientEmoji(c);
  const recentForThis = requests.filter(r => r.clientId === c.clientId).slice(-3).reverse();
  const detailHtml =
    '<div class="row"><span class="label">Type</span><span class="val">' + esc(c.transport) + (c.clientInfo ? ' • ' + esc(c.clientInfo.name) + ' v' + esc(c.clientInfo.version) : '') + '</span></div>' +
    '<div class="row"><span class="label">Client ID</span><span class="val">' + esc(c.clientId) + '</span></div>' +
    '<div class="row"><span class="label">Connected</span><span class="val">' + fmtRelTime(c.connectedAt) + ' (' + esc(c.connectedAt) + ')</span></div>' +
    '<div class="row"><span class="label">Tool calls</span><span class="val">' + c.recentRequestCount + ' in last 50</span></div>' +
    (recentForThis.length > 0 ? '<div class="recent-mini"><div class="mini-title">Recent activity</div>' +
      recentForThis.map(r => {
        const e = r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : r.status === 'pending' ? '⏳' : '⚠️';
        return '<div class="mini-row"><span class="mini-emoji">' + e + '</span>' + esc(r.tool) + ' → ' + esc(r.browserId.split(':')[0]) + ' (' + (r.durationMs != null ? r.durationMs + 'ms' : 'pending') + ')</div>';
      }).join('') + '</div>' : '');
  return '<button class="item" data-kind="mcp" data-idx="' + i + '" onclick="toggleItem(this)" aria-expanded="false">' +
    '<span class="item-emoji">' + emoji + '</span>' +
    '<span class="item-main"><b>' + esc(friendly) + '</b>' +
    '<span class="item-sub">' + esc(c.transport) + ' • ' + fmtRelTime(c.connectedAt) + '</span></span>' +
    '<span class="item-count">' + c.recentRequestCount + ' call' + (c.recentRequestCount === 1 ? '' : 's') + '</span>' +
    '<span class="item-caret">▸</span>' +
    '</button>' +
    '<div class="item-detail" data-detail-for="mcp-' + i + '" style="display:none">' + detailHtml + '</div>';
}

function renderBrowserItem(b, i, requests) {
  const brand = b.browserId.split(':')[0] || 'browser';
  const id = b.browserId.split(':')[1] || '';
  const emoji = browserBrandEmoji(brand);
  const recentForThis = requests.filter(r => r.browserId === b.browserId).slice(-3).reverse();
  const detailHtml =
    '<div class="row"><span class="label">Brand</span><span class="val">' + esc(brand) + '</span></div>' +
    '<div class="row"><span class="label">Browser ID</span><span class="val">' + esc(b.browserId) + '</span></div>' +
    '<div class="row"><span class="label">Connected</span><span class="val">' + fmtRelTime(b.connectedAt) + ' (' + esc(b.connectedAt) + ')</span></div>' +
    '<div class="row"><span class="label">Tool calls</span><span class="val">' + b.recentRequestCount + ' in last 50</span></div>' +
    (recentForThis.length > 0 ? '<div class="recent-mini"><div class="mini-title">Recent activity</div>' +
      recentForThis.map(r => {
        const e = r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : r.status === 'pending' ? '⏳' : '⚠️';
        return '<div class="mini-row"><span class="mini-emoji">' + e + '</span>' + esc(r.tool) + ' (' + (r.durationMs != null ? r.durationMs + 'ms' : 'pending') + ')</div>';
      }).join('') + '</div>' : '');
  return '<button class="item" data-kind="browser" data-idx="' + i + '" onclick="toggleItem(this)" aria-expanded="false">' +
    '<span class="item-emoji">' + emoji + '</span>' +
    '<span class="item-main"><b>' + esc(brand) + '</b>' +
    '<span class="item-sub">' + esc(id.slice(0, 12)) + '… • ' + fmtRelTime(b.connectedAt) + '</span></span>' +
    '<span class="item-count">' + b.recentRequestCount + ' call' + (b.recentRequestCount === 1 ? '' : 's') + '</span>' +
    '<span class="item-caret">▸</span>' +
    '</button>' +
    '<div class="item-detail" data-detail-for="browser-' + i + '" style="display:none">' + detailHtml + '</div>';
}

// Toggles an expandable detail panel beneath a list item. Persists open state
// across polls via the data-kind/data-idx pair stored in state.openItems.
function toggleItem(button) {
  const kind = button.dataset.kind;
  const idx = button.dataset.idx;
  const key = kind + '-' + idx;
  const detail = button.parentElement.querySelector('[data-detail-for="' + key + '"]');
  if (!detail) return;
  const willOpen = detail.style.display === 'none';
  detail.style.display = willOpen ? 'block' : 'none';
  button.classList.toggle('expanded', willOpen);
  button.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) state.openItems.add(key);
  else state.openItems.delete(key);
}
// Re-apply the "open" state after each render so user's clicks survive
// the 1.5s polling refresh.
function reapplyOpenItems() {
  for (const key of state.openItems) {
    const btn = document.querySelector('.item[data-kind="' + key.split('-')[0] + '"][data-idx="' + key.split('-')[1] + '"]');
    if (btn) {
      const detail = btn.parentElement.querySelector('[data-detail-for="' + key + '"]');
      if (detail) {
        detail.style.display = 'block';
        btn.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
      }
    }
  }
}

function renderActivity(reqs) {
  const list = document.getElementById('activity-list');
  document.getElementById('activity-count').textContent = reqs.length + ' action' + (reqs.length === 1 ? '' : 's');
  if (reqs.length === 0) {
    list.innerHTML = '<div class="activity-empty">No activity yet. Try asking your AI assistant to do something.</div>';
    return;
  }
  list.innerHTML = reqs.slice().reverse().map(r => {
    const emoji = r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : r.status === 'pending' ? '⏳' : '⚠️';
    const cls = r.status;
    const browser = r.browserId ? r.browserId.split(':')[0] : 'all';
    return '<div class="activity-row ' + cls + '">' +
      '<span class="activity-time">' + fmtRelTime(r.startedAt) + '</span>' +
      '<span class="activity-emoji">' + emoji + '</span>' +
      '<span class="activity-desc"><b>' + esc(r.tool) + '</b></span>' +
      '<span class="activity-target">' + esc(browser) + '</span>' +
      '<span class="activity-dur">' + (r.durationMs != null ? r.durationMs + 'ms' : '—') + '</span>' +
      '</div>';
  }).join('');
}

// ── Logs ───────────────────────────────────────────────────────────────
async function loadLogs() {
  for (const f of ['bridge', 'extension', 'helper']) {
    try {
      const r = await fetch('/api/logs?file=' + f + '&n=200');
      const json = await r.json();
      state.logs[f] = json.lines || [];
      document.getElementById('count-' + f).textContent = state.logs[f].length;
    } catch (err) {
      state.logs[f] = [];
    }
  }
  renderLogs();
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderLogs();
}

function renderLogs() {
  const view = document.getElementById('logs-view');
  const search = document.getElementById('logs-search').value.toLowerCase();
  const lines = state.logs[state.currentTab] || [];
  const filtered = search ? lines.filter(l => l.toLowerCase().includes(search)) : lines;
  if (filtered.length === 0) {
    view.innerHTML = '<div class="logs-empty">' + (search ? 'No matches for "' + esc(search) + '"' : 'No log entries yet') + '</div>';
    return;
  }
  view.innerHTML = filtered.map(line => {
    try {
      const j = JSON.parse(line);
      return '<div><span class="t">' + esc(j.t || '') + '</span> ' +
             '<span class="lvl-' + esc(j.lvl) + '">[' + esc(j.lvl) + ']</span> ' +
             '<span class="ev">' + esc(j.event) + '</span> ' +
             esc(JSON.stringify({...j, t: undefined, lvl: undefined, event: undefined, src: undefined}).slice(1, -1)) +
             '</div>';
    } catch {
      return '<div>' + esc(line) + '</div>';
    }
  }).join('');
  view.scrollTop = view.scrollHeight;
}

// ── Actions ────────────────────────────────────────────────────────────
async function action(name) {
  const endpoints = {
    'restart-bridge': { url: '/api/restart', confirmMsg: 'Restart the bridge? Connected clients will reconnect automatically.' },
    'reload-extension': { url: '/api/reload-extension', confirmMsg: 'Reload the browser extension? Open chats will continue.' },
  };
  const ep = endpoints[name];
  if (!ep) return;
  if (!confirm(ep.confirmMsg)) return;
  try {
    const r = await fetch(ep.url, { method: 'POST' });
    const j = await r.json();
    toast(j.message || (r.ok ? 'Done' : 'Failed'), !r.ok);
    setTimeout(poll, 1500);
  } catch (err) {
    toast('Request failed: ' + err.message, true);
  }
}

// ── Init ───────────────────────────────────────────────────────────────
poll();
loadLogs();
setInterval(poll, POLL_MS);
setInterval(loadLogs, 5000); // logs refresh every 5s
</script>
</body>
</html>
`;
