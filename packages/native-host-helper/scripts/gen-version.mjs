#!/usr/bin/env node
/**
 * Reads "version" from package.json and writes src/version.ts.
 *
 * Run automatically via npm lifecycle hooks (prebuild, prebundle, pretest) —
 * never hardcode HELPER_VERSION in src/version.ts directly.  The generated
 * file is git-ignored; this script is the single source of truth.
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
  `export const HELPER_VERSION = '${version}';`,
  '',
].join('\n');

const outPath = join(__dirname, '..', 'src', 'version.ts');
writeFileSync(outPath, content, 'utf-8');
console.log(`[gen-version] HELPER_VERSION = '${version}' → src/version.ts`);
