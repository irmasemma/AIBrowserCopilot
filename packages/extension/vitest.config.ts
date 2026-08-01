import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirror the wxt/@preact/preset-vite runtime aliasing so `react` imports
  // (pulled in transitively by zustand/react) resolve to preact/compat under
  // test — exactly as they do in the built extension. Without this, zustand's
  // React adapter loads real React, whose hook dispatcher is null in jsdom.
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // zustand's React adapter is normally externalized (bypassing the alias
    // above), so inline it — then vite transforms it and its `react` import is
    // redirected to preact/compat, matching the built extension.
    server: { deps: { inline: ['zustand'] } },
    // `.test.tsx` files are DOM/component tests; they opt into the jsdom
    // environment per-file via a `// @vitest-environment jsdom` docblock.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
