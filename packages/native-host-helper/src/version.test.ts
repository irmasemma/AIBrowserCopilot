/**
 * Invariant: HELPER_VERSION must always equal the version in package.json.
 *
 * This test fails immediately if someone bumps package.json but forgets to
 * regenerate version.ts (i.e., runs `npm version` without running
 * `npm run build` or `npm test` which triggers the prebuild/pretest hooks).
 *
 * It also covers the inverse: if gen-version.mjs produces the wrong value,
 * this test catches it before the binary is shipped.
 */

import { describe, it, expect } from 'vitest';
import { HELPER_VERSION } from './version.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('HELPER_VERSION — generated from package.json', () => {
  it('matches the version declared in package.json (drift detector)', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(HELPER_VERSION).toBe(pkg.version);
  });

  it('is a semver-shaped string', () => {
    expect(HELPER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
