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
  .toast { position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 12px 20px; border-radius: 12px; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 1001; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.error { background: #991b1b; }

  /* ── Activity row click affordance ─── */
  .activity-row { cursor: pointer; transition: transform 0.1s; }
  .activity-row:hover { transform: translateX(4px); }
  .activity-row::after { content: '▸'; color: #94a3b8; margin-left: 8px; }

  /* ── Drill-down modal ─── */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 24px;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
  }
  .modal-overlay.open { opacity: 1; pointer-events: auto; }
  .modal {
    background: white; border-radius: 16px; padding: 24px;
    max-width: 720px; width: 100%; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 24px 64px rgba(0,0,0,0.3);
    transform: translateY(20px); transition: transform 0.2s;
  }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;
  }
  .modal-title { font-size: 18px; font-weight: 700; margin: 0; }
  .modal-title-sub { color: #64748b; font-size: 13px; margin: 4px 0 0; }
  .modal-close {
    background: transparent; border: 0; cursor: pointer; padding: 4px 10px;
    font-size: 20px; color: #64748b; line-height: 1; border-radius: 8px;
  }
  .modal-close:hover { background: #f1f5f9; color: #0f172a; }
  .modal-summary {
    background: #f8fafc; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;
    display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px;
    font-size: 13px;
  }
  .modal-summary .lbl { color: #64748b; }
  .modal-summary .val { color: #0f172a; font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }

  /* Step timeline */
  .steps-section-title {
    font-size: 13px; font-weight: 600; color: #475569; margin: 12px 0 8px;
    display: flex; align-items: center; gap: 6px;
  }
  .step-list { display: flex; flex-direction: column; gap: 0; position: relative; }
  .step {
    display: grid; grid-template-columns: 32px 70px 1fr; gap: 12px;
    padding: 10px 0; align-items: flex-start; position: relative;
  }
  .step:not(:last-child)::before {
    content: ''; position: absolute; left: 15px; top: 32px; bottom: -2px;
    width: 2px; background: #e2e8f0;
  }
  .step.ok:not(:last-child)::before { background: #86efac; }
  .step.fail:not(:last-child)::before { background: #fca5a5; }
  .step-icon {
    width: 32px; height: 32px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font-size: 16px;
    flex-shrink: 0; z-index: 1;
  }
  .step.ok .step-icon { background: #dcfce7; color: #166534; }
  .step.fail .step-icon { background: #fee2e2; color: #991b1b; }
  .step.wait .step-icon { background: #fef3c7; color: #92400e; }
  .step.info .step-icon { background: #dbeafe; color: #1e40af; }
  .step-time {
    font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace;
    padding-top: 8px; line-height: 1.2;
  }
  .step-body { padding-top: 4px; }
  .step-msg { font-size: 14px; color: #0f172a; line-height: 1.5; }
  .step-cause {
    margin-top: 6px; font-size: 12px; color: #92400e; background: #fef3c7;
    border-left: 3px solid #fcd34d; padding: 6px 10px; border-radius: 4px;
  }

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
  .item.item-stale { border-color: #fca5a5; background: #fef2f2; }
  .item.item-stale:hover { background: #fee2e2; }
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

  /* Brand chips shown in the Browser Extension card. Visual summary of
     which browsers have the extension running, clickable to scroll to
     the Connected Browsers card for full detail. */
  .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .chip {
    background: white; border: 1px solid #cbd5e1; border-radius: 999px;
    padding: 3px 9px; font-size: 11px; color: #475569; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
    text-decoration: none; transition: all 0.12s;
    font-family: inherit;
  }
  .chip:hover { border-color: #3b82f6; color: #1e40af; background: #dbeafe; }
  .chip:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

  /* Highlight pulse for the target card after a chip click — gives users
     visual confirmation that the click did something. */
  @keyframes flash-highlight {
    0% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
  }
  .card.highlight { animation: flash-highlight 1.2s ease-out; }
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
      <p class="card-subtitle">AgentHub running inside browsers</p>
      <span class="status-badge idle">Loading…</span>
      <div class="card-meta" id="ext-meta">—</div>
      <div class="card-actions">
        <button class="btn" onclick="action('reload-extension')" title="Reload AgentHub extension in every connected browser">Reload all</button>
      </div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">Per-browser</span></div></div>
    <div class="card idle" id="card-browser">
      <div class="card-emoji">🌍</div>
      <p class="card-title">Connected Browsers</p>
      <p class="card-subtitle">Click each for details</p>
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

  <!-- Drill-down modal: opens when user clicks a row in Recent Activity. -->
  <div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div>
          <p class="modal-title" id="modalTitle">Request details</p>
          <p class="modal-title-sub" id="modalSubtitle">—</p>
        </div>
        <button class="modal-close" onclick="closeModal()" aria-label="Close">✕</button>
      </div>
      <div class="modal-summary" id="modalSummary"></div>
      <div class="steps-section-title">📋 What happened, step by step</div>
      <div class="step-list" id="modalSteps"></div>
    </div>
  </div>

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
  if (mcpCount === 0) {
    document.getElementById('mcp-meta').innerHTML =
      '<div class="item-empty">No AI assistant connected yet.</div>' +
      '<details><summary>How to connect</summary>Configure Claude / Cursor / VS Code with MCP server <code>agenthub</code>.</details>';
  } else {
    document.getElementById('mcp-meta').innerHTML =
      '<div class="item-list">' + s.mcpClients.map((c, i) =>
        renderClientItem(c, i, s.recentRequests || [])
      ).join('') + '</div>';
    // Auto-expand if there are few clients — info more useful visible.
    if (mcpCount <= 3) {
      s.mcpClients.forEach((_, i) => state.openItems.add('mcp-' + i));
    }
  }

  // Extension card — replaces the misleading "see next →" with actual
  // brand chips. Each chip is a real button that scrolls to + highlights
  // the matching browser in the Connected Browsers card, then expands it.
  // (Status badge is set further down, derived from per-browser liveness.)
  const extCount = s.browsers.length;
  if (extCount === 0) {
    document.getElementById('ext-meta').innerHTML =
      '<div class="item-empty">No browser extension connected.</div>' +
      '<details><summary>How to fix</summary>1. Open Chrome / Edge<br>2. Open the AgentHub side panel<br>3. Wait ~5 seconds</details>';
  } else {
    const brandCounts = {};
    s.browsers.forEach(b => {
      const brand = b.browserId.split(':')[0] || 'browser';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });
    const chips = Object.entries(brandCounts).map(([brand, count]) =>
      '<button class="chip" onclick="scrollToBrowser(\\'' + esc(brand) + '\\')" title="Click for details">' +
        browserBrandEmoji(brand) + ' ' + esc(brand) + (count > 1 ? ' ×' + count : '') +
      '</button>'
    ).join('');
    document.getElementById('ext-meta').innerHTML =
      '<b>' + extCount + '</b> browser' + (extCount === 1 ? '' : 's') + ' connected' +
      '<div class="chip-row">' + chips + '</div>';
  }

  // Browsers — interactive list (click each item to expand details).
  // Status is derived from LIVENESS (lastSeenAt) not socket presence —
  // a "connected but stale" browser shows yellow warning instead of green.
  const liveBrowsers = s.browsers.filter(b => b.liveness === 'live').length;
  const staleBrowsers = s.browsers.filter(b => b.liveness === 'stale').length;
  const browserBadgeStatus = extCount === 0 ? 'idle' : staleBrowsers > 0 ? 'warn' : 'ok';
  const browserBadgeLabel = extCount === 0
    ? 'No browsers'
    : staleBrowsers > 0
      ? (liveBrowsers + ' live, ' + staleBrowsers + ' stuck')
      : (liveBrowsers + ' live');
  setStatus('browser', browserBadgeStatus, browserBadgeLabel);
  if (s.browsers.length === 0) {
    document.getElementById('browser-meta').innerHTML = '<div class="item-empty">No browsers yet.</div>';
  } else {
    document.getElementById('browser-meta').innerHTML =
      '<div class="item-list">' + s.browsers.map((b, i) =>
        renderBrowserItem(b, i, s.recentRequests || [])
      ).join('') + '</div>';
    if (s.browsers.length <= 3) {
      // Default-expand all browsers when there are few — clicking each one
      // individually is annoying when the info fits on screen anyway.
      s.browsers.forEach((_, i) => state.openItems.add('browser-' + i));
    }
  }

  // Also reflect stale state on the Extension card.
  const extBadgeStatus = extCount === 0 ? 'bad' : staleBrowsers > 0 ? 'warn' : 'ok';
  const extBadgeLabel = extCount === 0
    ? 'Not connected'
    : staleBrowsers > 0
      ? (liveBrowsers + ' live, ' + staleBrowsers + ' stuck')
      : 'On';
  setStatus('ext', extBadgeStatus, extBadgeLabel);

  // Arrows — yellow when stale
  setArrow(0, mcpCount > 0 ? 'ok' : null);
  setArrow(1, extCount === 0 ? 'bad' : (staleBrowsers === extCount ? 'bad' : 'ok'));
  setArrow(2, liveBrowsers > 0 ? 'ok' : null);

  // Banner: surface common problems
  let banner = null;
  // Detect SW wedging from recent activity: a browser that's connected
  // (status green) but whose recent tool calls all timed out. Most common
  // cause is MV3 service worker suspension during a tool call.
  const recent = s.recentRequests || [];
  const timedOutByBrowser = {};
  recent.slice(-15).forEach(r => {
    if (r.status === 'timeout' && r.browserId && r.browserId !== 'all-browsers') {
      timedOutByBrowser[r.browserId] = (timedOutByBrowser[r.browserId] || 0) + 1;
    }
  });
  const wedgedBrowsers = Object.entries(timedOutByBrowser).filter(([, n]) => n >= 2);

  if (extCount === 0 && s.recentRejections.length > 0) {
    banner = 'Your browser extension is trying to connect but the bridge is rejecting it. The extension ID isn\\'t allowlisted. Run <code>npx agenthub-setup --extension-id &lt;your-id&gt;</code>.';
  } else if (extCount === 0) {
    banner = 'No browser extension connected. Open the AgentHub side panel in Chrome or Edge.';
  } else if (wedgedBrowsers.length > 0) {
    // Recent tool calls keep timing out against this browser even though
    // its WS is connected. Strong signal of a wedged MV3 service worker.
    const list = wedgedBrowsers.map(([id, n]) => esc(id.split(':')[0]) + ' (' + n + ' recent timeouts)').join(', ');
    banner = '⚠️ <b>Service worker may be stuck</b> in: <b>' + list + '</b>. Recent tool calls timed out even though the connection looks fine. Try the per-browser <b>"Reload this browser"</b> button in the Connected Browsers card below to wake it up.';
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
  // Liveness badge — STALE means OS-level WS is open but extension's SW
  // hasn't sent us anything in 45+ seconds (almost certainly wedged).
  const livenessLabel = b.liveness === 'live'
    ? '<span style="color:#16a34a">●</span> alive (heard ' + (b.lastSeenAgeSec ?? '?') + 's ago)'
    : b.liveness === 'stale'
      ? '<span style="color:#dc2626">●</span> STUCK (no answer for ' + (b.lastSeenAgeSec ?? '?') + 's)'
      : '<span style="color:#94a3b8">●</span> waiting for first message';
  // Per-browser reload button. Sends {type:'reload'} ONLY to this browser's
  // WS — doesn't reload Chrome when you only wanted to reload Edge.
  // Escape browserId for JS string literal embedding.
  const browserIdJs = b.browserId.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
  const detailHtml =
    '<div class="row"><span class="label">Brand</span><span class="val">' + esc(brand) + '</span></div>' +
    '<div class="row"><span class="label">Browser ID</span><span class="val">' + esc(b.browserId) + '</span></div>' +
    '<div class="row"><span class="label">Connected</span><span class="val">' + fmtRelTime(b.connectedAt) + ' (' + esc(b.connectedAt) + ')</span></div>' +
    '<div class="row"><span class="label">Liveness</span><span class="val">' + livenessLabel + '</span></div>' +
    '<div class="row"><span class="label">Tool calls</span><span class="val">' + b.recentRequestCount + ' in last 50</span></div>' +
    (recentForThis.length > 0 ? '<div class="recent-mini"><div class="mini-title">Recent activity</div>' +
      recentForThis.map(r => {
        const e = r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : r.status === 'pending' ? '⏳' : '⚠️';
        return '<div class="mini-row"><span class="mini-emoji">' + e + '</span>' + esc(r.tool) + ' (' + (r.durationMs != null ? r.durationMs + 'ms' : 'pending') + ')</div>';
      }).join('') + '</div>' : '') +
    '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #cbd5e1; display:flex; gap:6px;">' +
      '<button class="btn" onclick="reloadOneBrowser(\\'' + browserIdJs + '\\')" title="Reload AgentHub extension only in this browser">Reload this browser</button>' +
    '</div>';
  // Per-row class for status hint — orange border on stale rows.
  const itemExtraClass = b.liveness === 'stale' ? ' item-stale' : '';
  return '<button class="item' + itemExtraClass + '" data-kind="browser" data-idx="' + i + '" onclick="toggleItem(this)" aria-expanded="false">' +
    '<span class="item-emoji">' + emoji + '</span>' +
    '<span class="item-main"><b>' + esc(brand) + (b.liveness === 'stale' ? ' <span style="color:#dc2626;font-weight:700">⚠ STUCK</span>' : '') + '</b>' +
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

// Scrolls to + briefly highlights the Connected Browsers card, then
// expands every browser of the given brand. Called from the brand chips
// in the Extension card (e.g. clicking the "🟢 chrome ×2" chip).
function scrollToBrowser(brand) {
  const card = document.getElementById('card-browser');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Pulse highlight so user sees what was targeted
  card.classList.remove('highlight');
  void card.offsetWidth; // force reflow so re-adding the class restarts the animation
  card.classList.add('highlight');
  setTimeout(() => card.classList.remove('highlight'), 1300);
  // Expand all browser items whose brand matches
  if (state.state && state.state.browsers) {
    state.state.browsers.forEach((b, i) => {
      if ((b.browserId.split(':')[0] || '') === brand) {
        state.openItems.add('browser-' + i);
      }
    });
    reapplyOpenItems();
  }
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
    const emoji = r.status === 'success' ? '✅' : r.status === 'error' ? '❌' : r.status === 'pending' ? '⏳' : r.status === 'timeout' ? '⏱️' : '⚠️';
    const cls = r.status;
    const browser = r.browserId ? r.browserId.split(':')[0] : 'all';
    // Each row is clickable — opens a drill-down modal showing the full
    // step-by-step chain (received → liveness probe → tool sent → reply).
    return '<div class="activity-row ' + cls + '" onclick="openCallDetail(\\'' + esc(r.browserBoundId) + '\\')" title="Click for full details" role="button" tabindex="0">' +
      '<span class="activity-time">' + fmtRelTime(r.startedAt) + '</span>' +
      '<span class="activity-emoji">' + emoji + '</span>' +
      '<span class="activity-desc"><b>' + esc(r.tool) + '</b></span>' +
      '<span class="activity-target">' + esc(browser) + '</span>' +
      '<span class="activity-dur">' + (r.durationMs != null ? r.durationMs + 'ms' : '—') + '</span>' +
      '</div>';
  }).join('');
}

// ── Drill-down modal ─────────────────────────────────────────────────────
async function openCallDetail(browserBoundId) {
  try {
    const r = await fetch('/api/request/' + encodeURIComponent(browserBoundId));
    if (!r.ok) {
      toast('Could not load request details (status ' + r.status + ')', true);
      return;
    }
    const { request } = await r.json();
    renderCallDetail(request);
    document.getElementById('modalOverlay').classList.add('open');
  } catch (err) {
    toast('Failed to load: ' + err.message, true);
  }
}

function closeModal(evt) {
  // Close only on backdrop click — not clicks inside the modal body
  if (evt && evt.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
}

function renderCallDetail(req) {
  const emoji = req.status === 'success' ? '✅' : req.status === 'error' ? '❌' : req.status === 'pending' ? '⏳' : req.status === 'timeout' ? '⏱️' : '⚠️';
  const brand = req.browserId.split(':')[0] || 'browser';
  document.getElementById('modalTitle').innerHTML = emoji + ' <b>' + esc(req.tool) + '</b> → ' + esc(brand);
  document.getElementById('modalSubtitle').textContent =
    'Started ' + fmtRelTime(req.startedAt) +
    (req.durationMs != null ? ' · took ' + req.durationMs + 'ms' : ' · still running');

  // Summary panel
  const summary = document.getElementById('modalSummary');
  summary.innerHTML =
    '<span class="lbl">Asked by</span><span class="val">' + esc(req.clientId) + '</span>' +
    '<span class="lbl">Tool</span><span class="val">' + esc(req.tool) + '</span>' +
    '<span class="lbl">Browser</span><span class="val">' + esc(req.browserId) + '</span>' +
    '<span class="lbl">Status</span><span class="val">' + esc(req.status) + (req.errorMessage ? ' (' + esc(req.errorMessage) + ')' : '') + '</span>' +
    '<span class="lbl">Request ID</span><span class="val">' + esc(req.browserBoundId) + '</span>';

  // Step timeline
  const stepsEl = document.getElementById('modalSteps');
  if (!req.steps || req.steps.length === 0) {
    stepsEl.innerHTML = '<div class="activity-empty">No step trace recorded. (Old request? Restart bridge for new requests to be traced.)</div>';
    return;
  }
  stepsEl.innerHTML = req.steps.map(step => {
    const icon = step.status === 'ok' ? '✓' : step.status === 'fail' ? '✕' : step.status === 'wait' ? '⌛' : 'ℹ';
    const time = step.t.split('T')[1].slice(0, 12);
    return '<div class="step ' + esc(step.status) + '">' +
      '<div class="step-icon">' + icon + '</div>' +
      '<div class="step-time">' + esc(time) + '</div>' +
      '<div class="step-body">' +
        '<div class="step-msg">' + esc(step.message) + '</div>' +
        (step.cause ? '<div class="step-cause">💡 ' + esc(step.cause) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Allow Esc to close the modal too — accessibility nicety
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

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
    'reload-extension': { url: '/api/reload-extension', confirmMsg: 'Reload AgentHub extension in ALL connected browsers? Open chats in any of them will be lost.' },
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

// Targeted reload for a single browser. Sends the {type:'reload'} signal
// ONLY to that browser's WebSocket. Other connected browsers are unaffected
// (no extension reload, no SW death, no side panel loss).
async function reloadOneBrowser(browserId) {
  if (!confirm('Reload AgentHub extension in ' + browserId.split(':')[0] + '?\\nThis browser will reload its extension (open chats there will be lost). Other browsers are NOT affected.')) return;
  try {
    const url = '/api/reload-extension?browserId=' + encodeURIComponent(browserId);
    const r = await fetch(url, { method: 'POST' });
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
