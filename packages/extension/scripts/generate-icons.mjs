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
// gradient; foreground is a friendly bot face — rounded-square head, two
// circular eyes with sparkle highlights, a small smile, and a tiny antenna
// for unambiguous bot-ness. Reads as "AI assistant" at glance and the
// silhouette (blue square + white rounded-rect + two dark eyes) still
// resolves at 16×16 (the toolbar size).
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#5B95FF"/>
      <stop offset="100%" stop-color="#1A73E8"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="26" ry="26" fill="url(#bg)"/>

  <!-- Antenna: vertical stem + ball on top of the head -->
  <line x1="64" y1="22" x2="64" y2="34" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="17" r="6" fill="#FFFFFF"/>

  <!-- Head: rounded square, slightly taller than wide, white -->
  <rect x="26" y="36" width="76" height="72" rx="18" ry="18" fill="#FFFFFF"/>

  <!-- Eyes: two filled blue circles -->
  <circle cx="49" cy="64" r="9" fill="#1A73E8"/>
  <circle cx="79" cy="64" r="9" fill="#1A73E8"/>

  <!-- Eye highlights: small white dots for "alive" feel -->
  <circle cx="52" cy="61" r="2.5" fill="#FFFFFF"/>
  <circle cx="82" cy="61" r="2.5" fill="#FFFFFF"/>

  <!-- Friendly smile -->
  <path d="M 48 86 Q 64 95 80 86" stroke="#1A73E8" stroke-width="5" stroke-linecap="round" fill="none"/>
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
