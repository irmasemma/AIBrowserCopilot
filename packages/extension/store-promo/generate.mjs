// Render the Chrome Web Store promo tiles:
//   - Small promo tile     440×280  (search-result thumbnail)
//   - Marquee promo tile  1400×560  (featured/marquee placement)
//
// Both as 24-bit PNG (no alpha) — CWS requirement.
//
// Run (from packages/extension/store-promo):
//   node generate.mjs
// Output:
//   ./out/small-promo-440x280.png
//   ./out/marquee-promo-1400x560.png

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
mkdirSync(OUT_DIR, { recursive: true });

const PALETTE = {
  bgFrom: '#5B95FF',
  bgTo: '#1A73E8',
  white: '#FFFFFF',
  whiteSoft: 'rgba(255, 255, 255, 0.85)',
  whiteDim: 'rgba(255, 255, 255, 0.6)',
  eyeDark: '#1A73E8',
};

const BOT_SVG = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg-bot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#7AAEFF"/>
      <stop offset="100%" stop-color="#1A73E8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="26" ry="26" fill="${PALETTE.white}"/>
  <line x1="64" y1="22" x2="64" y2="34" stroke="${PALETTE.eyeDark}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="17" r="6" fill="${PALETTE.eyeDark}"/>
  <rect x="26" y="36" width="76" height="72" rx="18" ry="18" fill="url(#bg-bot)"/>
  <circle cx="49" cy="64" r="9" fill="${PALETTE.white}"/>
  <circle cx="79" cy="64" r="9" fill="${PALETTE.white}"/>
  <circle cx="52" cy="61" r="2.5" fill="${PALETTE.eyeDark}"/>
  <circle cx="82" cy="61" r="2.5" fill="${PALETTE.eyeDark}"/>
  <path d="M 48 86 Q 64 95 80 86" stroke="${PALETTE.white}" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>`;

// Inverted-palette bot for placement on the dark blue background: white
// outer rounded-square so it pops, blue inner head so the face still reads.

const COMMON_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    color: ${PALETTE.white};
    -webkit-font-smoothing: antialiased;
    background: linear-gradient(135deg, ${PALETTE.bgFrom} 0%, ${PALETTE.bgTo} 100%);
  }
  /* Soft decorative blob in the background — adds depth without clutter */
  .blob {
    position: absolute; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%);
    pointer-events: none;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Small promo tile — 440×280
// Goal: in <1 second of glance, communicate "AI in your sidebar."
// Layout: bot icon on left, headline + 1 subhead + provider chips on right.
// ─────────────────────────────────────────────────────────────────────────────

const smallPromoHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${COMMON_CSS}
  body { width: 440px; height: 280px; overflow: hidden; position: relative; }
  .blob.a { width: 340px; height: 340px; top: -120px; right: -100px; }
  .blob.b { width: 200px; height: 200px; bottom: -70px; left: -70px; }
  .root {
    position: relative; z-index: 1;
    width: 100%; height: 100%;
    display: flex; align-items: center; gap: 24px;
    padding: 24px 28px;
  }
  .bot-wrap {
    width: 140px; height: 140px;
    flex-shrink: 0;
    filter: drop-shadow(0 6px 16px rgba(0,0,0,0.18));
  }
  .text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .brand {
    font-size: 30px; font-weight: 700; letter-spacing: -0.5px;
    line-height: 1.1;
  }
  .headline {
    font-size: 18px; font-weight: 500;
    line-height: 1.25;
    color: ${PALETTE.whiteSoft};
  }
  .providers {
    margin-top: 10px;
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .chip {
    font-size: 11px; font-weight: 500;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
    border: 1px solid rgba(255,255,255,0.28);
    white-space: nowrap;
  }
</style></head>
<body>
  <div class="blob a"></div>
  <div class="blob b"></div>
  <div class="root">
    <div class="bot-wrap">${BOT_SVG(140)}</div>
    <div class="text">
      <div class="brand">AgentHub</div>
      <div class="headline">AI sidebar +<br/>MCP for your browser</div>
      <div class="providers">
        <span class="chip">Claude</span>
        <span class="chip">Cursor</span>
        <span class="chip">ChatGPT</span>
        <span class="chip">VS Code</span>
      </div>
    </div>
  </div>
</body></html>`;

// ─────────────────────────────────────────────────────────────────────────────
// Marquee promo tile — 1400×560
// Goal: hero placement. More room for the value proposition + features.
// Layout: bot + brand block on left, hero headline + feature chips on right.
// ─────────────────────────────────────────────────────────────────────────────

const marqueeHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${COMMON_CSS}
  body { width: 1400px; height: 560px; overflow: hidden; position: relative; }
  .blob.a { width: 800px; height: 800px; top: -200px; right: -200px; }
  .blob.b { width: 500px; height: 500px; bottom: -180px; left: -100px; }
  .root {
    position: relative; z-index: 1;
    width: 100%; height: 100%;
    display: grid; grid-template-columns: 520px 1fr;
    gap: 60px;
    padding: 56px 80px;
    align-items: center;
  }
  .brand-block { display: flex; flex-direction: column; gap: 28px; align-items: flex-start; }
  .bot-wrap {
    width: 200px; height: 200px;
    filter: drop-shadow(0 12px 32px rgba(0,0,0,0.25));
  }
  .brand-name {
    font-size: 56px; font-weight: 700; letter-spacing: -1.2px;
    line-height: 1.05;
  }
  .brand-sub {
    font-size: 18px; font-weight: 500;
    color: ${PALETTE.whiteSoft};
    max-width: 420px;
    line-height: 1.4;
  }
  .right { display: flex; flex-direction: column; gap: 24px; }
  .hero {
    font-size: 52px; font-weight: 700; letter-spacing: -1px;
    line-height: 1.08;
    max-width: 720px;
  }
  .hero .accent { color: #FFE57F; }
  .features {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 14px 28px;
    margin-top: 10px;
  }
  .feature {
    display: flex; align-items: center; gap: 12px;
    font-size: 17px; font-weight: 500;
    color: ${PALETTE.whiteSoft};
  }
  .feature .check {
    width: 26px; height: 26px; border-radius: 50%;
    background: rgba(255,255,255,0.22);
    border: 1px solid rgba(255,255,255,0.4);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .feature .check svg { display: block; }
  .providers-row {
    margin-top: 20px;
    display: flex; flex-wrap: wrap; gap: 8px;
  }
  .providers-row .chip {
    font-size: 14px; font-weight: 500;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
    border: 1px solid rgba(255,255,255,0.3);
  }
</style></head>
<body>
  <div class="blob a"></div>
  <div class="blob b"></div>
  <div class="root">
    <div class="brand-block">
      <div class="bot-wrap">${BOT_SVG(200)}</div>
      <div class="brand-name">AgentHub</div>
      <div class="brand-sub">
        Let your AI read pages, fill forms, click, and extract data —
        in your real Chrome, with your real sessions.
      </div>
    </div>
    <div class="right">
      <div class="hero">
        Your AI, <span class="accent">your browser.</span>
      </div>
      <div class="features">
        <div class="feature">
          <span class="check">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7l3 3 7-7" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </span>
          Chat sidebar — OpenAI, Anthropic, Gemini
        </div>
        <div class="feature">
          <span class="check">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7l3 3 7-7" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </span>
          MCP bridge for every major AI tool
        </div>
        <div class="feature">
          <span class="check">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7l3 3 7-7" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </span>
          Read pages · Fill forms · Click · Extract
        </div>
        <div class="feature">
          <span class="check">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7l3 3 7-7" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
          </span>
          Local keys · Per-tool toggles · Free
        </div>
      </div>
      <div class="providers-row">
        <span class="chip">Claude Code</span>
        <span class="chip">Cursor</span>
        <span class="chip">VS Code</span>
        <span class="chip">Windsurf</span>
        <span class="chip">ChatGPT</span>
        <span class="chip">Gemini</span>
        <span class="chip">JetBrains</span>
        <span class="chip">Zed</span>
      </div>
    </div>
  </div>
</body></html>`;

const TILES = [
  { name: 'small-promo-440x280', html: smallPromoHtml, width: 440, height: 280 },
  { name: 'marquee-promo-1400x560', html: marqueeHtml, width: 1400, height: 560 },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const tile of TILES) {
    const ctx = await browser.newContext({
      viewport: { width: tile.width, height: tile.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.setContent(tile.html, { waitUntil: 'load' });
    const outPath = path.join(OUT_DIR, `${tile.name}.png`);
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: tile.width, height: tile.height },
      // omitBackground: false → 24-bit PNG with opaque body background (CWS requirement)
      omitBackground: false,
      type: 'png',
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
