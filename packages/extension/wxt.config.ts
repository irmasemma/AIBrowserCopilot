import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  manifest: {
    name: 'AI Browser CoPilot',
    version: '0.1.0',
    description: 'Connect your browser to your AI assistant. Read pages, fill forms, extract data — no terminal required.',
    permissions: ['tabs', 'sidePanel', 'nativeMessaging', 'storage', 'scripting'],
    host_permissions: ['<all_urls>'],
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
