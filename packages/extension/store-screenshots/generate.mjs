// Render 5 Chrome Web Store listing screenshots at 1280×800 PNG from inline
// HTML mockups. Each scene composes a Chrome-window frame (tab strip + address
// bar) with page content on the left ~71% and a Pilotwave side panel on the
// right 360 px. See ../../../docs/screenshots-brief.md for the source spec.
//
// Usage (from packages/extension/store-screenshots):
//   node generate.mjs
//
// Output: ./out/01-chat-hero.png through ./out/05-multi-tab.png

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');

const PALETTE = {
  pageBg: '#FFFFFF',
  panelBg: '#FAFAFA',
  divider: '#E0E0E0',
  text: '#202124',
  textMuted: '#5F6368',
  brandPrimary: '#1A73E8',
  okGreen: '#34A853',
  warnAmber: '#F9AB00',
  bubbleUser: '#1A73E8',
  bubbleUserText: '#FFFFFF',
  bubbleAssistant: '#FFFFFF',
  toolCardBg: '#F1F3F4',
  toolCardBorder: '#E0E0E0',
  inputBg: '#F1F3F4',
};

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 1280px; height: 800px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  font-size: 13px; color: ${PALETTE.text}; -webkit-font-smoothing: antialiased;
  background: #E5E5E5;
}
.chrome { width: 1280px; height: 800px; display: flex; flex-direction: column;
  background: ${PALETTE.pageBg}; overflow: hidden; }
.tabstrip { height: 40px; background: #DEE1E6; display: flex;
  align-items: flex-end; padding: 0 8px; gap: 2px; flex-shrink: 0; }
.tab { height: 32px; padding: 0 14px 0 12px; min-width: 140px; max-width: 220px;
  background: #DEE1E6; border-radius: 10px 10px 0 0; display: flex;
  align-items: center; font-size: 12px; color: ${PALETTE.text};
  gap: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border: 1px solid transparent; }
.tab.active { background: #FFFFFF; border-color: #D5D8DD; border-bottom-color: #FFFFFF; }
.tab-fav { width: 14px; height: 14px; border-radius: 50%; background: #C4C7C5;
  flex-shrink: 0; }
.tab-title { overflow: hidden; text-overflow: ellipsis; }
.tab-close { width: 14px; height: 14px; opacity: 0.5; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 14px; }
.new-tab { width: 28px; height: 28px; margin-bottom: 2px; display: flex;
  align-items: center; justify-content: center; color: ${PALETTE.textMuted};
  font-size: 18px; line-height: 1; }
.addrbar { height: 52px; background: #FFFFFF; border-bottom: 1px solid ${PALETTE.divider};
  display: flex; align-items: center; padding: 0 12px; gap: 10px; flex-shrink: 0; }
.nav-btn { width: 28px; height: 28px; display: flex; align-items: center;
  justify-content: center; color: ${PALETTE.textMuted}; font-size: 16px;
  border-radius: 50%; }
.url-pill { flex: 1; height: 34px; background: #F1F3F4; border-radius: 17px;
  display: flex; align-items: center; padding: 0 14px; font-size: 13px;
  color: #1F1F1F; gap: 8px; }
.url-pill .lock { font-size: 13px; color: ${PALETTE.textMuted}; }
.profile-dot { width: 28px; height: 28px; border-radius: 50%;
  background: ${PALETTE.brandPrimary}; color: #FFFFFF; display: flex;
  align-items: center; justify-content: center; font-weight: 600; font-size: 12px; }
.content { display: flex; height: 708px; flex: 1; min-height: 0; }
.page { flex: 1; background: ${PALETTE.pageBg}; overflow: hidden; }
.panel { width: 360px; background: ${PALETTE.panelBg};
  border-left: 1px solid ${PALETTE.divider}; display: flex; flex-direction: column;
  flex-shrink: 0; }
.panel-header { height: 48px; background: #FFFFFF; border-bottom: 1px solid ${PALETTE.divider};
  display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; }
.brand { font-weight: 600; font-size: 14px; letter-spacing: -0.1px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: ${PALETTE.okGreen}; }
.status-label { font-size: 11px; color: ${PALETTE.okGreen}; font-weight: 500; }
.panel-tabs { height: 38px; background: #FFFFFF; border-bottom: 1px solid ${PALETTE.divider};
  display: flex; flex-shrink: 0; }
.panel-tab { flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: ${PALETTE.textMuted}; border-bottom: 2px solid transparent;
  font-weight: 500; }
.panel-tab.active { color: ${PALETTE.brandPrimary}; border-bottom-color: ${PALETTE.brandPrimary}; }
.panel-body { flex: 1; overflow: hidden; padding: 12px; display: flex;
  flex-direction: column; gap: 10px; min-height: 0; }
.bubble-row { display: flex; }
.bubble-row.user { justify-content: flex-end; }
.bubble { max-width: 85%; padding: 9px 12px; border-radius: 12px;
  font-size: 13px; line-height: 1.4; }
.bubble.user { background: ${PALETTE.bubbleUser}; color: ${PALETTE.bubbleUserText};
  border-bottom-right-radius: 4px; }
.bubble.assistant { background: ${PALETTE.bubbleAssistant};
  color: ${PALETTE.text}; border: 1px solid ${PALETTE.divider};
  border-bottom-left-radius: 4px; box-shadow: 0 1px 1px rgba(0,0,0,0.03); }
.bubble .spinner { display: inline-block; width: 10px; height: 10px;
  border-radius: 50%; background: ${PALETTE.brandPrimary};
  margin-right: 6px; opacity: 0.6; }
.tool-card { background: ${PALETTE.toolCardBg}; border: 1px solid ${PALETTE.toolCardBorder};
  border-radius: 8px; padding: 8px 10px; font-size: 12px;
  color: ${PALETTE.textMuted}; align-self: flex-start; max-width: 92%;
  display: flex; flex-direction: column; gap: 4px; }
.tool-card .name { color: ${PALETTE.text}; font-weight: 600; font-family:
  'SF Mono', Menlo, Consolas, monospace; font-size: 11.5px; }
.tool-card .args { font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px; color: ${PALETTE.textMuted}; }
.tool-card .result-line { display: flex; align-items: center; gap: 6px;
  color: ${PALETTE.okGreen}; font-weight: 500; }
.result-table { background: #FFFFFF; border: 1px solid ${PALETTE.divider};
  border-radius: 8px; padding: 8px 10px; align-self: flex-start; width: 100%; }
.result-table table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.result-table th, .result-table td { padding: 4px 6px; text-align: left;
  border-bottom: 1px solid ${PALETTE.divider}; }
.result-table th { color: ${PALETTE.textMuted}; font-weight: 600;
  text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px; }
.result-table tr:last-child td { border-bottom: none; }
.panel-input { flex-shrink: 0; padding: 10px 12px;
  border-top: 1px solid ${PALETTE.divider}; background: #FFFFFF; display: flex;
  gap: 6px; align-items: center; }
.panel-input .box { flex: 1; height: 36px; border: 1px solid ${PALETTE.divider};
  border-radius: 8px; display: flex; align-items: center; padding: 0 10px;
  font-size: 12px; color: ${PALETTE.textMuted}; background: #FFFFFF; }
.panel-input .send { width: 56px; height: 32px; border-radius: 6px;
  background: ${PALETTE.brandPrimary}; color: #FFFFFF; font-size: 12px;
  font-weight: 500; display: flex; align-items: center; justify-content: center; }
`;

const chromeShell = ({ tabs, url, content }) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>
<body>
  <div class="chrome">
    <div class="tabstrip">
      ${tabs.map(t => `
        <div class="tab ${t.active ? 'active' : ''}">
          <div class="tab-fav"></div>
          <div class="tab-title">${t.title}</div>
          <div class="tab-close">×</div>
        </div>`).join('')}
      <div class="new-tab">+</div>
    </div>
    <div class="addrbar">
      <div class="nav-btn">←</div>
      <div class="nav-btn">→</div>
      <div class="nav-btn">↻</div>
      <div class="url-pill"><span class="lock">🔒</span>${url}</div>
      <div class="nav-btn">⋮</div>
      <div class="profile-dot">J</div>
    </div>
    <div class="content">
      ${content}
    </div>
  </div>
</body></html>`;

const panelHeader = (activeTab = 'Chat') => `
<div class="panel-header">
  <div class="brand">Pilotwave</div>
  <div style="flex:1"></div>
  <div class="status-dot"></div>
  <div class="status-label">Connected</div>
</div>
<div class="panel-tabs">
  ${['Chat', 'Tools', 'Settings'].map(t => `
    <div class="panel-tab ${t === activeTab ? 'active' : ''}">${t}</div>`).join('')}
</div>`;

// ─── Scene 1 — chat hero ────────────────────────────────────────────────────

const scene1 = () => chromeShell({
  tabs: [
    { title: 'Jane Doe | LinkedIn', active: true },
    { title: 'Acme Corp – Crunchbase', active: false },
    { title: 'Pilotwave: AI Chat…', active: false },
  ],
  url: 'linkedin.example/in/jane-doe',
  content: `
    <div class="page" style="padding: 24px 32px; overflow: hidden;">
      <style>
        .lk-hero { display: flex; gap: 20px; margin-bottom: 18px; }
        .lk-avatar { width: 96px; height: 96px; border-radius: 50%;
          background: linear-gradient(135deg, #D4E2FF 0%, #B6CFFF 100%);
          flex-shrink: 0; }
        .lk-name { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
        .lk-headline { font-size: 14px; color: ${PALETTE.text}; margin: 0 0 6px; }
        .lk-meta { font-size: 12px; color: ${PALETTE.textMuted}; }
        .lk-section { margin-top: 24px; padding-top: 18px;
          border-top: 1px solid ${PALETTE.divider}; }
        .lk-section h2 { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
        .lk-exp { display: flex; gap: 14px; margin-bottom: 16px; }
        .lk-logo { width: 44px; height: 44px; border-radius: 6px;
          flex-shrink: 0; }
        .lk-logo.acme { background: #1A73E8; }
        .lk-logo.globex { background: #34A853; }
        .lk-logo.initech { background: #F9AB00; }
        .lk-exp-role { font-size: 14px; font-weight: 600; margin: 0; }
        .lk-exp-company { font-size: 13px; color: ${PALETTE.text}; margin: 2px 0 2px; }
        .lk-exp-dates { font-size: 12px; color: ${PALETTE.textMuted}; }
      </style>
      <div class="lk-hero">
        <div class="lk-avatar"></div>
        <div>
          <h1 class="lk-name">Jane Doe</h1>
          <p class="lk-headline">Senior Product Manager at Acme Corp</p>
          <p class="lk-meta">San Francisco Bay Area · 500+ connections</p>
        </div>
      </div>
      <div class="lk-section">
        <h2>Experience</h2>
        <div class="lk-exp">
          <div class="lk-logo acme"></div>
          <div>
            <p class="lk-exp-role">Senior Product Manager</p>
            <p class="lk-exp-company">Acme Corp · Full-time</p>
            <p class="lk-exp-dates">2023 – Present · 2 yrs · San Francisco, CA</p>
          </div>
        </div>
        <div class="lk-exp">
          <div class="lk-logo globex"></div>
          <div>
            <p class="lk-exp-role">Product Manager</p>
            <p class="lk-exp-company">Globex Inc · Full-time</p>
            <p class="lk-exp-dates">2020 – 2023 · 3 yrs · Remote</p>
          </div>
        </div>
        <div class="lk-exp">
          <div class="lk-logo initech"></div>
          <div>
            <p class="lk-exp-role">Associate Product Manager</p>
            <p class="lk-exp-company">Initech LLC · Full-time</p>
            <p class="lk-exp-dates">2018 – 2020 · 2 yrs · New York, NY</p>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      ${panelHeader('Chat')}
      <div class="panel-body">
        <div class="bubble-row user">
          <div class="bubble user">Extract every job from this profile into a table</div>
        </div>
        <div class="bubble-row">
          <div class="bubble assistant"><span class="spinner"></span>Reading the page… calling extract_data…</div>
        </div>
        <div class="tool-card">
          <div class="name">extract_data</div>
          <div class="args">{ selector: ".experience-section" }</div>
          <div class="result-line">✓ 3 records · 92 ms</div>
        </div>
        <div class="result-table">
          <table>
            <thead><tr><th>Company</th><th>Role</th><th>Dates</th></tr></thead>
            <tbody>
              <tr><td>Acme Corp</td><td>Senior PM</td><td>2023 – Present</td></tr>
              <tr><td>Globex Inc</td><td>PM</td><td>2020 – 2023</td></tr>
              <tr><td>Initech LLC</td><td>APM</td><td>2018 – 2020</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel-input">
        <div class="box">Ask anything about this page…</div>
        <div class="send">Send</div>
      </div>
    </div>`,
});

// ─── Scene 2 — MCP settings ─────────────────────────────────────────────────

const scene2 = () => chromeShell({
  tabs: [
    { title: 'New Tab', active: true },
    { title: 'Pilotwave: AI Chat…', active: false },
  ],
  url: 'chrome://newtab',
  content: `
    <div class="page" style="display: flex; align-items: flex-start;
        justify-content: center; padding-top: 96px; background: #F8F9FA;">
      <div style="text-align: center;">
        <div style="font-family: 'Google Sans', Arial, sans-serif;
            font-size: 92px; letter-spacing: -2px; color: ${PALETTE.textMuted};
            font-weight: 400;">Google</div>
        <div style="margin-top: 28px; width: 560px; height: 48px;
            border-radius: 24px; background: #FFFFFF; border: 1px solid #DADCE0;
            display: flex; align-items: center; padding: 0 20px;
            font-size: 14px; color: ${PALETTE.textMuted};">Search Google or type a URL</div>
      </div>
    </div>
    <div class="panel">
      ${panelHeader('Settings')}
      <div class="panel-body" style="overflow-y: hidden;">
        <style>
          .s-section { background: #FFFFFF; border: 1px solid ${PALETTE.divider};
            border-radius: 10px; padding: 12px 14px; }
          .s-title { font-size: 11.5px; font-weight: 600; color: ${PALETTE.textMuted};
            text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 10px; }
          .s-row { display: flex; align-items: center; gap: 8px; padding: 4px 0;
            font-size: 13px; }
          .s-row .chk { color: ${PALETTE.okGreen}; font-weight: 600; }
          .s-row.dim { color: ${PALETTE.textMuted}; }
          .s-row.dim .chk { color: #BDC1C6; }
          .s-code { background: #F8F9FA; border: 1px solid ${PALETTE.divider};
            border-radius: 6px; padding: 8px 10px; font-family: 'SF Mono', Menlo,
            Consolas, monospace; font-size: 10.5px; color: ${PALETTE.text};
            white-space: pre; margin-top: 10px; line-height: 1.45; }
          .s-btn { margin-top: 8px; display: inline-flex; padding: 6px 12px;
            border-radius: 6px; background: ${PALETTE.brandPrimary};
            color: #FFFFFF; font-size: 12px; font-weight: 500; }
          .s-key { display: flex; align-items: center;
            border: 1px solid ${PALETTE.divider}; border-radius: 6px;
            padding: 8px 10px; font-family: 'SF Mono', Menlo, Consolas, monospace;
            font-size: 12px; color: ${PALETTE.text}; background: #F8F9FA; }
          .s-help { font-size: 11px; color: ${PALETTE.textMuted};
            margin-top: 6px; }
          .s-select { display: flex; align-items: center; justify-content: space-between;
            border: 1px solid ${PALETTE.divider}; border-radius: 6px;
            padding: 8px 10px; font-size: 12px; color: ${PALETTE.text};
            background: #FFFFFF; }
          .s-select::after { content: '▾'; color: ${PALETTE.textMuted}; }
        </style>
        <div class="s-section">
          <div class="s-title">MCP Connection</div>
          <div class="s-row"><div class="status-dot"></div>
            <span>Connected via native messaging</span></div>
          <div style="margin-top: 8px;">
            <div class="s-row"><span class="chk">✓</span> Claude Code</div>
            <div class="s-row"><span class="chk">✓</span> Cursor</div>
            <div class="s-row"><span class="chk">✓</span> VS Code</div>
            <div class="s-row"><span class="chk">✓</span> Windsurf</div>
            <div class="s-row dim"><span class="chk">○</span> Continue</div>
            <div class="s-row dim"><span class="chk">○</span> Zed</div>
          </div>
          <div class="s-code">{
  "mcpServers": {
    "pilotwave": {
      "command": "%LOCALAPPDATA%/pilotwave/native-host.exe"
    }
  }
}</div>
          <div class="s-btn">Copy MCP config</div>
        </div>
        <div class="s-section">
          <div class="s-title">OpenAI API Key</div>
          <div class="s-key">sk-•••••••••••••••••••••••••••• abcd</div>
          <div class="s-help">Used only for the chat tab. Stored locally.</div>
        </div>
        <div class="s-section">
          <div class="s-title">Model</div>
          <div class="s-select">gpt-4o-mini</div>
        </div>
      </div>
    </div>`,
});

// ─── Scene 3 — Tools tab + activity log ────────────────────────────────────

const scene3 = () => chromeShell({
  tabs: [
    { title: 'Jane Doe | LinkedIn', active: true },
    { title: 'Salesforce — Lightning', active: false },
    { title: 'Pilotwave: AI Chat…', active: false },
  ],
  url: 'linkedin.example/in/jane-doe',
  content: `
    <div class="page" style="padding: 32px; background: #F8F9FA;">
      <div style="background: #FFFFFF; border: 1px solid ${PALETTE.divider};
          border-radius: 8px; padding: 28px; max-width: 720px;
          margin: 32px auto 0;">
        <h1 style="margin: 0 0 12px; font-size: 22px;">Jane Doe</h1>
        <p style="margin: 0; color: ${PALETTE.textMuted}; font-size: 13px;">
          Senior Product Manager at Acme Corp · San Francisco Bay Area
        </p>
        <div style="height: 1px; background: ${PALETTE.divider}; margin: 18px 0;"></div>
        <p style="font-size: 13px; line-height: 1.5;">
          Product leader with 7+ years building data-driven SaaS. Currently
          shipping the analytics workflow at Acme Corp. Previously at Globex Inc
          and Initech LLC.
        </p>
      </div>
    </div>
    <div class="panel">
      ${panelHeader('Tools')}
      <div class="panel-body" style="overflow: hidden;">
        <style>
          .t-section-title { font-size: 11.5px; font-weight: 600;
            color: ${PALETTE.textMuted}; text-transform: uppercase;
            letter-spacing: 0.5px; margin: 0 0 6px; }
          .t-row { display: flex; align-items: center;
            padding: 8px 12px; background: #FFFFFF;
            border-bottom: 1px solid ${PALETTE.divider}; font-size: 13px; }
          .t-row:first-child { border-radius: 8px 8px 0 0; }
          .t-row:last-child { border-radius: 0 0 8px 8px; border-bottom: none; }
          .t-card { background: #FFFFFF; border: 1px solid ${PALETTE.divider};
            border-radius: 8px; overflow: hidden; }
          .t-label { flex: 1; }
          .toggle { width: 32px; height: 18px; border-radius: 9px;
            background: ${PALETTE.brandPrimary}; position: relative;
            flex-shrink: 0; }
          .toggle::after { content: ''; position: absolute; width: 14px;
            height: 14px; border-radius: 50%; background: #FFFFFF;
            top: 2px; right: 2px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
          .toggle.off { background: #BDC1C6; }
          .toggle.off::after { right: 16px; }
          .log { background: #1E1E1E; color: #E8EAED; border-radius: 8px;
            padding: 10px 12px; font-family: 'SF Mono', Menlo, Consolas, monospace;
            font-size: 10.5px; line-height: 1.7; overflow: hidden;
            white-space: pre; }
          .log .ts { color: #8AB4F8; }
          .log .tool { color: #FDD663; }
          .log .meta { color: #81C995; }
          .clear-btn { align-self: flex-end; font-size: 11px;
            color: ${PALETTE.brandPrimary}; padding: 4px 8px; }
        </style>
        <div class="t-section-title">Permissions</div>
        <div class="t-card">
          <div class="t-row"><div class="t-label">Read page content</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">Take screenshots</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">List tabs</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">Navigate</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">Fill forms</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">Click elements</div><div class="toggle"></div></div>
          <div class="t-row"><div class="t-label">Extract tables</div><div class="toggle off"></div></div>
          <div class="t-row"><div class="t-label">Extract structured data</div><div class="toggle"></div></div>
        </div>
        <div class="t-section-title" style="margin-top: 4px;">Activity log</div>
        <div class="log">
<span class="ts">21:34:12</span>  <span class="tool">extract_data</span>      /in/jane-doe       <span class="meta">14 rows</span>
<span class="ts">21:34:08</span>  <span class="tool">get_page_content</span>  /in/jane-doe       <span class="meta">4.2 KB</span>
<span class="ts">21:33:51</span>  <span class="tool">take_screenshot</span>   tab 3              <span class="meta">1280×800</span>
<span class="ts">21:33:42</span>  <span class="tool">list_tabs</span>         —                  <span class="meta">7 tabs</span>
<span class="ts">21:33:29</span>  <span class="tool">navigate</span>          lightning/r/Lead   <span class="meta">ok</span>
        </div>
        <div class="clear-btn">Clear log</div>
      </div>
    </div>`,
});

// ─── Scene 4 — Form fill ────────────────────────────────────────────────────

const scene4 = () => chromeShell({
  tabs: [
    { title: 'New Lead | Salesforce', active: true },
    { title: 'Jane Doe | LinkedIn', active: false },
    { title: 'Pilotwave: AI Chat…', active: false },
  ],
  url: 'salesforce.example/lightning/o/Lead/new',
  content: `
    <div class="page" style="padding: 0; background: #F4F6F9; overflow: hidden;">
      <div style="background: #FFFFFF; border-bottom: 1px solid ${PALETTE.divider};
          padding: 16px 28px;">
        <div style="font-size: 11px; color: ${PALETTE.textMuted};">LEADS</div>
        <div style="font-size: 19px; font-weight: 600; margin-top: 2px;">New Lead</div>
      </div>
      <div style="padding: 24px 28px; overflow-y: hidden;">
        <style>
          .f-section { background: #FFFFFF; border: 1px solid ${PALETTE.divider};
            border-radius: 6px; padding: 18px 20px; margin-bottom: 14px; }
          .f-h { font-size: 13px; font-weight: 600; margin: 0 0 14px;
            padding-bottom: 8px; border-bottom: 1px solid ${PALETTE.divider}; }
          .f-grid { display: grid; grid-template-columns: 1fr 1fr;
            gap: 14px 24px; }
          .f-field label { display: block; font-size: 11px; color: ${PALETTE.textMuted};
            margin-bottom: 4px; font-weight: 500; }
          .f-input { width: 100%; height: 32px; border: 1px solid ${PALETTE.divider};
            border-radius: 4px; padding: 0 10px; font-size: 13px;
            color: ${PALETTE.text}; background: #FFFFFF; display: flex;
            align-items: center; }
          .f-input.dropdown::after { content: '▾'; color: ${PALETTE.textMuted};
            margin-left: auto; }
          .f-input.highlight { box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.25);
            border-color: ${PALETTE.brandPrimary}; }
        </style>
        <div class="f-section">
          <h3 class="f-h">Lead Information</h3>
          <div class="f-grid">
            <div class="f-field"><label>First Name</label>
              <div class="f-input">Jane</div></div>
            <div class="f-field"><label>Last Name</label>
              <div class="f-input">Doe</div></div>
            <div class="f-field"><label>Email</label>
              <div class="f-input">jane.doe@acme.example</div></div>
            <div class="f-field"><label>Phone</label>
              <div class="f-input">+1 (555) 010-4477</div></div>
            <div class="f-field"><label>Company</label>
              <div class="f-input dropdown"><span>Acme Corp</span></div></div>
            <div class="f-field"><label>Title</label>
              <div class="f-input highlight">Senior Product Manager</div></div>
            <div class="f-field"><label>Lead Source</label>
              <div class="f-input dropdown"><span>Website</span></div></div>
            <div class="f-field"><label>Status</label>
              <div class="f-input dropdown"><span style="color: ${PALETTE.textMuted}">— None —</span></div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      ${panelHeader('Chat')}
      <div class="panel-body">
        <div class="bubble-row user">
          <div class="bubble user">Fill this form: Jane Doe, Sr PM at Acme Corp, jane.doe@acme.example, source = website</div>
        </div>
        <div class="bubble-row">
          <div class="bubble assistant">Filling 7 fields…</div>
        </div>
        <div class="tool-card">
          <div class="name">fill_form</div>
          <div class="args">{ tab_id: 1, fields: 7 }</div>
          <div class="result-line">✓ 7 fields filled</div>
        </div>
        <div class="bubble-row">
          <div class="bubble assistant">Done. All 7 fields written. Review before saving.</div>
        </div>
      </div>
      <div class="panel-input">
        <div class="box">Ask anything about this page…</div>
        <div class="send">Send</div>
      </div>
    </div>`,
});

// ─── Scene 5 — Multi-tab orchestration ─────────────────────────────────────

const scene5 = () => chromeShell({
  tabs: [
    { title: 'Jane Doe – Contact | Salesforce', active: true },
    { title: 'Jane Doe | LinkedIn', active: false },
    { title: 'Acme Corp – Crunchbase', active: false },
    { title: 'Pilotwave: AI Chat…', active: false },
  ],
  url: 'salesforce.example/lightning/r/Contact/003.../view',
  content: `
    <div class="page" style="padding: 0; background: #F4F6F9; overflow: hidden;">
      <div style="background: #FFFFFF; border-bottom: 1px solid ${PALETTE.divider};
          padding: 16px 28px; display: flex; align-items: center; gap: 14px;">
        <div style="width: 40px; height: 40px; border-radius: 50%;
          background: linear-gradient(135deg, #FFD66B 0%, #FFA000 100%);"></div>
        <div>
          <div style="font-size: 11px; color: ${PALETTE.textMuted};">CONTACT</div>
          <div style="font-size: 19px; font-weight: 600;">Jane Doe</div>
        </div>
      </div>
      <div style="padding: 24px 28px;">
        <style>
          .c-section { background: #FFFFFF; border: 1px solid ${PALETTE.divider};
            border-radius: 6px; padding: 18px 20px; margin-bottom: 14px; }
          .c-h { font-size: 13px; font-weight: 600; margin: 0 0 14px;
            padding-bottom: 8px; border-bottom: 1px solid ${PALETTE.divider}; }
          .c-grid { display: grid; grid-template-columns: 1fr 1fr;
            gap: 14px 24px; }
          .c-row label { display: block; font-size: 11px; color: ${PALETTE.textMuted};
            margin-bottom: 3px; font-weight: 500; }
          .c-row .v { font-size: 13px; color: ${PALETTE.text}; min-height: 18px; }
          .c-row .v.empty { color: ${PALETTE.textMuted}; font-style: italic; }
          .c-notes { font-size: 13px; line-height: 1.5; padding: 8px 10px;
            background: #F8F9FA; border-radius: 4px; border: 1px solid ${PALETTE.divider};
            min-height: 60px; }
          .c-notes.filled { background: #E8F0FE; border-color: ${PALETTE.brandPrimary}; }
        </style>
        <div class="c-section">
          <h3 class="c-h">Contact Details</h3>
          <div class="c-grid">
            <div class="c-row"><label>Email</label>
              <div class="v">jane@acme.example</div></div>
            <div class="c-row"><label>Phone</label>
              <div class="v empty">—</div></div>
            <div class="c-row"><label>Company</label>
              <div class="v">Acme Corp</div></div>
            <div class="c-row"><label>Title</label>
              <div class="v">Senior Product Manager</div></div>
          </div>
        </div>
        <div class="c-section">
          <h3 class="c-h">Notes</h3>
          <div class="c-notes filled">
            Email: jane@acme.example. Acme Corp closed Series B in Mar 2024, $42M led by Sequoia.
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      ${panelHeader('Chat')}
      <div class="panel-body">
        <div class="bubble-row user">
          <div class="bubble user">Find Jane's email from Tab 2 and her company's funding round from Tab 3. Fill them into the notes field here.</div>
        </div>
        <div class="tool-card">
          <div class="name">list_tabs</div>
          <div class="result-line">✓ 4 tabs found</div>
        </div>
        <div class="tool-card">
          <div class="name">get_page_content <span style="color:${PALETTE.textMuted}">(tab 2)</span></div>
          <div class="result-line">✓ "jane@acme.example"</div>
        </div>
        <div class="tool-card">
          <div class="name">get_page_content <span style="color:${PALETTE.textMuted}">(tab 3)</span></div>
          <div class="result-line">✓ "Series B, $42M, Mar 2024"</div>
        </div>
        <div class="tool-card">
          <div class="name">fill_form <span style="color:${PALETTE.textMuted}">(tab 1)</span></div>
          <div class="result-line">✓ Notes field updated</div>
        </div>
        <div class="bubble-row">
          <div class="bubble assistant">Done. Notes filled.</div>
        </div>
      </div>
      <div class="panel-input">
        <div class="box">Ask anything about this page…</div>
        <div class="send">Send</div>
      </div>
    </div>`,
});

const SCENES = [
  { name: '01-chat-hero', html: scene1() },
  { name: '02-mcp-settings', html: scene2() },
  { name: '03-tools-log', html: scene3() },
  { name: '04-form-fill', html: scene4() },
  { name: '05-multi-tab', html: scene5() },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const scene of SCENES) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.setContent(scene.html, { waitUntil: 'load' });
    const outPath = path.join(OUT_DIR, `${scene.name}.png`);
    await page.screenshot({
      path: outPath,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });
    console.log(`wrote ${outPath}`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
