import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'AgentHub — AI Chat + MCP for Claude, Cursor, ChatGPT',
    version: '0.5.16',
    description: 'Let AI control your real Chrome — your tabs, sessions, logins. Chat sidebar + MCP for Claude, Cursor, and ChatGPT.',
    permissions: ['tabs', 'sidePanel', 'nativeMessaging', 'storage', 'scripting', 'debugger', 'alarms'],
    host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
      // Bridge diagnostics endpoint. Required for the side panel to fetch
      // /api/state directly (instead of going through the slow native-
      // messaging helper round-trip on Windows). Localhost-only fetch;
      // bridge enforces origin-allowlist before responding.
      'http://127.0.0.1/*',
    ],
    // <all_urls> as OPTIONAL: required host_permissions can't be re-granted
    // via chrome.permissions.request — Edge's "Site access: On click" UI
    // toggle is then the only way to re-enable, requiring manual user
    // navigation through edge://extensions. As optional, our side panel
    // banner can call permissions.request and trigger a real prompt.
    optional_host_permissions: ['<all_urls>'],
    icons: {
      '16': 'assets/icon-16.png',
      '48': 'assets/icon-48.png',
      '128': 'assets/icon-128.png',
    },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
