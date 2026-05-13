// Capture the hero screenshot (01-chat-hero.png) using a REAL LinkedIn
// profile in REAL Edge with the user's logged-in session, then overlay the
// Pilotwave side panel mockup on the right 360px. Output: out/01-chat-hero.png
// at 1280×800.
//
// Setup:
//   * Closes any running msedge.exe (user-data-dir is locked otherwise).
//   * Mounts %LOCALAPPDATA%\Microsoft\Edge\User Data via a junction at
//     %TEMP%\copilot-real-edge-userdata so Chromium 136+'s CDP "default
//     user-data-dir" gate passes.
//   * Disables all installed Edge extensions for this session so any real
//     Pilotwave install doesn't open its own side panel and conflict with
//     the overlay.
//
// Usage (from packages/extension/store-screenshots):
//   node generate-hero.mjs

import { chromium } from '@playwright/test';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
mkdirSync(OUT_DIR, { recursive: true });

const EDGE_EXE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const REAL_USER_DATA_DIR = path.join(
  process.env.LOCALAPPDATA ?? '',
  'Microsoft',
  'Edge',
  'User Data',
);
const JUNCTION = path.join(os.tmpdir(), 'copilot-real-edge-userdata');
const LINKEDIN_URL = 'https://www.linkedin.com/in/irma-semma-64828891';

const findEdgeExe = () => {
  for (const p of EDGE_EXE_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('msedge.exe not found in standard install paths');
};

const isEdgeRunning = () => {
  const r = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq msedge.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf-8',
  });
  return r.status === 0 && /msedge\.exe/i.test(r.stdout);
};

const killEdge = () => {
  if (!isEdgeRunning()) return;
  try {
    execSync('taskkill /IM msedge.exe /F', { stdio: 'ignore', timeout: 10_000 });
  } catch {
    /* taskkill exits non-zero when nothing matches */
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!isEdgeRunning()) return;
    execSync('cmd /c "ping -n 1 127.0.0.1 >nul"', { stdio: 'ignore' });
  }
};

const ensureJunction = () => {
  if (existsSync(JUNCTION)) {
    try {
      const st = lstatSync(JUNCTION);
      if (st.isSymbolicLink()) return JUNCTION;
    } catch {
      /* recreate */
    }
    throw new Error(`${JUNCTION} exists but is not a junction — remove it manually`);
  }
  const r = spawnSync('cmd.exe', ['/c', 'mklink', '/J', JUNCTION, REAL_USER_DATA_DIR], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`Failed to create junction:\n${r.stdout}\n${r.stderr}`);
  }
  return JUNCTION;
};

// Side-panel mockup (Chat tab, hero state). Matches the styling of
// generate.mjs scene #1 minus the Chrome shell — this is overlaid as a fixed
// strip on the right 360px of the LinkedIn page.
const SIDE_PANEL_HTML = `
<style>
  .pw-panel * { box-sizing: border-box; }
  .pw-panel { width: 360px; height: 800px; background: #FAFAFA;
    border-left: 1px solid #E0E0E0; display: flex; flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial,
      sans-serif; font-size: 13px; color: #202124;
    -webkit-font-smoothing: antialiased; }
  .pw-h { height: 48px; background: #FFFFFF;
    border-bottom: 1px solid #E0E0E0; display: flex; align-items: center;
    padding: 0 14px; gap: 8px; flex-shrink: 0; }
  .pw-brand { font-weight: 600; font-size: 14px; letter-spacing: -0.1px; }
  .pw-dot { width: 8px; height: 8px; border-radius: 50%; background: #34A853; }
  .pw-status { font-size: 11px; color: #34A853; font-weight: 500; }
  .pw-tabs { height: 38px; background: #FFFFFF;
    border-bottom: 1px solid #E0E0E0; display: flex; flex-shrink: 0; }
  .pw-tab { flex: 1; display: flex; align-items: center;
    justify-content: center; font-size: 12px; color: #5F6368;
    border-bottom: 2px solid transparent; font-weight: 500; }
  .pw-tab.active { color: #1A73E8; border-bottom-color: #1A73E8; }
  .pw-body { flex: 1; padding: 12px; display: flex;
    flex-direction: column; gap: 10px; min-height: 0; overflow: hidden; }
  .pw-row { display: flex; }
  .pw-row.user { justify-content: flex-end; }
  .pw-bubble { max-width: 85%; padding: 9px 12px; border-radius: 12px;
    font-size: 13px; line-height: 1.4; }
  .pw-bubble.user { background: #1A73E8; color: #FFFFFF;
    border-bottom-right-radius: 4px; }
  .pw-bubble.asst { background: #FFFFFF; color: #202124;
    border: 1px solid #E0E0E0; border-bottom-left-radius: 4px;
    box-shadow: 0 1px 1px rgba(0,0,0,0.03); }
  .pw-bubble .pw-spin { display: inline-block; width: 10px; height: 10px;
    border-radius: 50%; background: #1A73E8; margin-right: 6px; opacity: 0.6; }
  .pw-tool { background: #F1F3F4; border: 1px solid #E0E0E0;
    border-radius: 8px; padding: 8px 10px; font-size: 12px;
    color: #5F6368; align-self: flex-start; max-width: 92%;
    display: flex; flex-direction: column; gap: 4px; }
  .pw-tool .pw-name { color: #202124; font-weight: 600;
    font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11.5px; }
  .pw-tool .pw-args { font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 11px; color: #5F6368; }
  .pw-tool .pw-ok { color: #34A853; font-weight: 500; }
  .pw-table { background: #FFFFFF; border: 1px solid #E0E0E0;
    border-radius: 8px; padding: 8px 10px; align-self: flex-start; width: 100%; }
  .pw-table table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .pw-table th, .pw-table td { padding: 4px 6px; text-align: left;
    border-bottom: 1px solid #E0E0E0; }
  .pw-table th { color: #5F6368; font-weight: 600;
    text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px; }
  .pw-table tr:last-child td { border-bottom: none; }
  .pw-input { flex-shrink: 0; padding: 10px 12px;
    border-top: 1px solid #E0E0E0; background: #FFFFFF; display: flex;
    gap: 6px; align-items: center; }
  .pw-input .pw-box { flex: 1; height: 36px; border: 1px solid #E0E0E0;
    border-radius: 8px; display: flex; align-items: center; padding: 0 10px;
    font-size: 12px; color: #5F6368; background: #FFFFFF; }
  .pw-input .pw-send { width: 56px; height: 32px; border-radius: 6px;
    background: #1A73E8; color: #FFFFFF; font-size: 12px;
    font-weight: 500; display: flex; align-items: center;
    justify-content: center; }
</style>
<div class="pw-panel">
  <div class="pw-h">
    <div class="pw-brand">Pilotwave</div>
    <div style="flex:1"></div>
    <div class="pw-dot"></div>
    <div class="pw-status">Connected</div>
  </div>
  <div class="pw-tabs">
    <div class="pw-tab active">Chat</div>
    <div class="pw-tab">Tools</div>
    <div class="pw-tab">Settings</div>
  </div>
  <div class="pw-body">
    <div class="pw-row user">
      <div class="pw-bubble user">Extract this profile into a table</div>
    </div>
    <div class="pw-row">
      <div class="pw-bubble asst"><span class="pw-spin"></span>Reading the page… calling extract_data…</div>
    </div>
    <div class="pw-tool">
      <div class="pw-name">extract_data</div>
      <div class="pw-args">{ schema: "profile" }</div>
      <div class="pw-ok">✓ extracted · 84 ms</div>
    </div>
    <div class="pw-table">
      <table>
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody id="pw-rows"></tbody>
      </table>
    </div>
  </div>
  <div class="pw-input">
    <div class="pw-box">Ask anything about this page…</div>
    <div class="pw-send">Send</div>
  </div>
</div>`;

const main = async () => {
  const chromeExe = findEdgeExe();
  if (!existsSync(REAL_USER_DATA_DIR)) {
    throw new Error(`Edge user-data-dir not found at ${REAL_USER_DATA_DIR}`);
  }

  console.log('Killing any running Edge…');
  killEdge();
  console.log('Mounting profile junction…');
  ensureJunction();

  console.log('Launching Edge with real profile, extensions disabled…');
  const context = await chromium.launchPersistentContext(JUNCTION, {
    executablePath: chromeExe,
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=msEnterpriseSiteList,msEnterpriseSiteListService,EnterpriseSiteListService,InternetExplorerIntegration',
    ],
    // Keep the user's installed extensions out of the way — overlay would
    // otherwise fight the real Pilotwave side panel if it's installed.
    ignoreDefaultArgs: ['--enable-automation'],
    timeout: 60_000,
  });

  // Disable extensions explicitly via headerless: pass a fresh page that
  // doesn't trigger the side panel. Side panel auto-opens only on the active
  // tab when the user clicks the action — first-load doesn't trigger it.

  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 800 });

  // LinkedIn serves public-profile vs Join-LinkedIn non-deterministically to
  // anonymous visitors. Retry navigation until we see the actual profile
  // (h1 text is the user's name, not "Join LinkedIn"). Up to 4 attempts.
  let attempts = 0;
  while (attempts < 4) {
    attempts += 1;
    console.log(`Attempt ${attempts}: navigating to ${LINKEDIN_URL}…`);
    try {
      await page.goto(LINKEDIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      console.warn(`goto warning: ${err instanceof Error ? err.message : err}`);
    }
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const h1Text = await page
      .evaluate(() => (document.querySelector('h1')?.textContent ?? '').trim())
      .catch(() => '');
    console.log(`  h1 = "${h1Text}"`);
    if (h1Text && !/join linkedin/i.test(h1Text) && !/sign in/i.test(h1Text)) {
      break;
    }
    console.log('  → got join/sign-in wall, retrying after a brief pause…');
    await page.waitForTimeout(3500);
  }

  // Auto-scroll: if the experience section loads on scroll, nudge it.
  await page
    .evaluate(() => {
      window.scrollTo({ top: 600, behavior: 'instant' });
    })
    .catch(() => undefined);
  await page.waitForTimeout(800);
  await page
    .evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    })
    .catch(() => undefined);

  // Extract visible profile facts (works for both logged-in and logged-out
  // views since these fields are public). Name / headline / location /
  // current company / education / connections — all visible above the
  // experience fold.
  const profile = await page
    .evaluate(() => {
      const txt = (el) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
      // Name: <h1> at top of profile.
      const name = txt(document.querySelector('h1'));
      // Headline: typically the first <div> with .text-body-medium beneath h1.
      const headline = txt(document.querySelector('.text-body-medium'));
      // Location: walk forward from the H1 (profile name) and find the first
      // small text node that looks like a city/state/country line. Avoids
      // "People also viewed" sidebar entries.
      let location = '';
      const h1 = document.querySelector('h1');
      if (h1) {
        let walker = h1;
        for (let i = 0; i < 60 && walker; i += 1) {
          walker = walker.nextElementSibling ?? walker.parentElement?.nextElementSibling ?? null;
          if (!walker) break;
          for (const el of Array.from(walker.querySelectorAll('span, div'))) {
            const t = txt(el);
            // Reasonable city/state line — short, has comma+state, not a profile blurb
            if (t.length > 8 && t.length < 80 && /,\s+[A-Z][a-z]+/.test(t)
                && !/follower|connection|profile|view/i.test(t)) {
              location = t;
              break;
            }
          }
          if (location) break;
        }
      }
      // Current company: the first highlight card under the profile header
      // labelled as a Company link. Logged-out view shows it as a "company"
      // line; logged-in shows the same as the first .pv-text card.
      let currentCompany = '';
      let education = '';
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const href = a.getAttribute('href') ?? '';
        const t = txt(a);
        if (!t || t.length > 80) continue;
        if (!currentCompany && /\/company\//.test(href)) currentCompany = t;
        if (!education && /\/school\//.test(href)) education = t;
      }
      // Connections count — pick the most specific match (e.g. "500+ connections")
      // rather than a long compound line.
      let network = '';
      for (const el of Array.from(document.querySelectorAll('span, div'))) {
        const t = txt(el);
        if (/^[\d.,KkMm+]+\s*connection/i.test(t) && t.length < 40) {
          network = t;
          break;
        }
      }
      return { name, headline, location, currentCompany, education, network };
    })
    .catch(() => ({ name: '', headline: '', location: '', currentCompany: '', education: '', network: '' }));

  console.log('Extracted profile:', profile);

  const ROWS = [
    profile.name && { field: 'Name', value: profile.name },
    profile.headline && { field: 'Headline', value: profile.headline },
    profile.location && { field: 'Location', value: profile.location },
    profile.currentCompany && { field: 'Current', value: profile.currentCompany },
    profile.education && { field: 'Education', value: profile.education },
    profile.network && { field: 'Network', value: profile.network },
  ].filter(Boolean).slice(0, 5);

  // Inject overlay with the side-panel mockup populated from real rows.
  await page.evaluate(
    ({ html, rows }) => {
      // Hide LinkedIn's right rail (Other similar profiles / People you may
      // know) — at 1280 px wide it pokes out just LEFT of our 360 px overlay
      // and looks like a cutoff artefact. Reserving the right ~440 px for our
      // overlay keeps the boundary clean.
      const css = document.createElement('style');
      css.textContent = `
        aside, [class*="right-rail"], [class*="rightRail"],
        [aria-label*="similar"], [aria-label*="people you may know"] {
          display: none !important;
        }
        body > div, .scaffold-layout, .scaffold-layout__main {
          max-width: 880px !important;
        }
      `;
      document.head.appendChild(css);

      const container = document.createElement('div');
      container.id = 'pw-overlay';
      container.style.cssText =
        'position: fixed; top: 0; right: 0; width: 360px; height: 100vh;' +
        ' z-index: 2147483647; pointer-events: none;' +
        ' background: #FAFAFA;' +
        ' box-shadow: -1px 0 0 0 #E0E0E0 inset;';
      container.innerHTML = html;
      document.body.appendChild(container);
      const tbody = container.querySelector('#pw-rows');
      if (tbody) {
        tbody.innerHTML = rows
          .map((r) => `<tr><td>${r.field}</td><td>${r.value}</td></tr>`)
          .join('');
      }
    },
    { html: SIDE_PANEL_HTML, rows: ROWS },
  );

  // Settle paint.
  await page.waitForTimeout(500);

  const outPath = path.join(OUT_DIR, '01-chat-hero.png');
  await page.screenshot({
    path: outPath,
    fullPage: false,
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  console.log(`wrote ${outPath}`);
  await context.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
