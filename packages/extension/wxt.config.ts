import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'AI Browser CoPilot',
    version: '0.1.0',
    description: 'Connect your browser to your AI assistant. Read pages, fill forms, extract data — no terminal required.',
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
