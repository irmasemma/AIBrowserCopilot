import { defineConfig } from '@playwright/test';
import path from 'path';
// Load .env (gitignored) so provider keys for install-and-chat.spec.ts can be
// stored locally instead of passed inline each run. Env always wins over .env.
import 'dotenv/config';

// WXT builds into <outDir>/chrome-mv3, so the unpacked extension (with its
// manifest.json) lives in dist/chrome-mv3 — pointing at dist alone loads nothing.
// Matches scripts/launch-edge-debug.mjs (the real-edge-via-cdp path).
const extensionPath = path.resolve(__dirname, 'packages/extension/dist/chrome-mv3');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  // Real-browser e2e specs (install-and-connect, install-and-chat) share a
  // single user-data-dir junction at %TEMP%\copilot-real-edge-userdata —
  // running multiple workers makes the second worker hit "Opening in existing
  // browser session" and fail. Pin to one worker globally; the affected specs
  // are short and serial within themselves.
  workers: 1,
  use: {
    headless: false, // Extensions require headed mode
  },
  projects: [
    {
      name: 'chromium-extension',
      // Default project: the original suite that launches its own Chromium.
      // Excludes specs that attach to a pre-running real Edge.
      testIgnore: ['**/real-edge-via-cdp-*.spec.ts'],
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--no-first-run',
            '--disable-default-apps',
          ],
        },
      },
    },
    {
      name: 'real-edge-via-cdp',
      // Attaches over CDP to a real Edge started via `npm run edge:debug`.
      // Each spec calls attachToRealEdge() itself, so no launchOptions here.
      testMatch: ['**/real-edge-via-cdp-*.spec.ts'],
    },
  ],
});
