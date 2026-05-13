import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'Pilotwave: AI Chat + MCP for Claude, Cursor, ChatGPT — Forms, Data',
    version: '0.4.0',
    description: 'Let AI control your real Chrome — your tabs, sessions, logins. Chat sidebar + MCP for Claude, Cursor, ChatGPT, VS Code.',
    permissions: ['tabs', 'sidePanel', 'nativeMessaging', 'storage', 'scripting', 'debugger', 'alarms'],
    host_permissions: [
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'https://generativelanguage.googleapis.com/*',
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
