// Render the AgentHub logo (SVG) to 16/48/128 PNG via Playwright.
//
// Source-of-truth SVG below; PNGs are derived. Edit the SVG, rerun:
//   node scripts/generate-icons.mjs
// Output overwrites:
//   public/assets/icon-16.png, icon-48.png, icon-128.png

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '..', 'public', 'assets');
mkdirSync(ASSETS_DIR, { recursive: true });

// 128-unit viewBox. Background is a rounded square with a vertical blue
// gradient; foreground is a bold white wave (two crests) with a small dot
// above the second crest — reads as motion + an "agent" guiding it. Stroke
// widths are picked so the silhouette still resolves at 16×16.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#5B95FF"/>
      <stop offset="100%" stop-color="#1A73E8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="26" ry="26" fill="url(#bg)"/>
  <path d="M 22 82
           Q 40 50, 58 82
           T 96 82"
        fill="none" stroke="#FFFFFF" stroke-width="14"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="100" cy="38" r="9" fill="#FFFFFF"/>
</svg>`;

const SIZES = [16, 48, 128];

const renderPage = (size) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style></head><body>${SVG}</body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const size of SIZES) {
    const ctx = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.setContent(renderPage(size), { waitUntil: 'load' });
    const outPath = path.join(ASSETS_DIR, `icon-${size}.png`);
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: true,
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
