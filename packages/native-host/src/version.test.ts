/**
 * Invariant: VERSION must always equal the version in package.json.
 * BUILD_ID must respect the process.env.BUILD_ID override at module load.
 *
 * The version test fails immediately if package.json is bumped without
 * regenerating version.ts (i.e., without running prebuild / pretest hooks).
 *
 * The BUILD_ID tests verify that the generated constant expression
 * `process.env.BUILD_ID ?? 'dev'` is preserved correctly by gen-version.mjs.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('VERSION — generated from package.json', () => {
  it('matches the version declared in package.json (drift detector)', async () => {
    const { VERSION } = await import('./version.js');
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('is a semver-shaped string', async () => {
    const { VERSION } = await import('./version.js');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('BUILD_ID — env override semantics', () => {
  const originalBuildId = process.env.BUILD_ID;

  afterEach(() => {
    // Restore env and clear module cache so the next test gets a fresh import.
    if (originalBuildId === undefined) {
      delete process.env.BUILD_ID;
    } else {
      process.env.BUILD_ID = originalBuildId;
    }
    vi.resetModules();
  });

  it('defaults to "dev" when BUILD_ID env var is unset', async () => {
    delete process.env.BUILD_ID;
    vi.resetModules();
    const { BUILD_ID } = await import('./version.js');
    expect(BUILD_ID).toBe('dev');
  });

  it('uses the BUILD_ID env var value when set (release-script override)', async () => {
    process.env.BUILD_ID = 'sha-abc1234-release';
    vi.resetModules();
    const { BUILD_ID } = await import('./version.js');
    expect(BUILD_ID).toBe('sha-abc1234-release');
  });
});
