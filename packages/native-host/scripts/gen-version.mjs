#!/usr/bin/env node
/**
 * Reads "version" from package.json and writes src/version.ts.
 *
 * Run automatically via npm lifecycle hooks (prebuild, prebundle, pretest,
 * pretypecheck) — never hardcode VERSION in src/version.ts directly.  The
 * generated file is git-ignored; this script is the single source of truth.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const content = [
  '// GENERATED — DO NOT EDIT.',
  '// Source of truth is package.json "version". See scripts/gen-version.mjs.',
  '',
  '// Single source of truth for the native-host bridge version.',
  '// Imported by index.ts (--version flag), service.ts (server_info + lock file).',
  `export const VERSION = '${version}';`,
  '',
  '// Build identifier — surfaced via server_info so the extension diagnostics',
  '// panel can show users exactly which build is running. Resolved at process',
  "// START from the BUILD_ID env var (NOT inlined at compile time — esbuild does",
  '// not `define` it), so set BUILD_ID in the environment before launching/',
  "// compiling to bake a static value; otherwise it falls back to 'dev'.",
  "export const BUILD_ID = process.env.BUILD_ID ?? 'dev';",
  '',
].join('\n');

const outPath = join(__dirname, '..', 'src', 'version.ts');
writeFileSync(outPath, content, 'utf-8');
console.log(`[gen-version] VERSION = '${version}' → src/version.ts`);
