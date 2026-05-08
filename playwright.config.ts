import { defineConfig } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, 'packages/extension/dist');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
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
