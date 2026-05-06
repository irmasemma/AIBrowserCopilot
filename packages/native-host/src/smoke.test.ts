import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BIN_DIR = join(__dirname, '..', 'bin');
const SERVICE_EXE = join(BIN_DIR, 'ai-browser-copilot-service-win-x64.exe');
const STUB_EXE = join(BIN_DIR, 'ai-browser-copilot-stub-win-x64.exe');

const EXPECTED_VERSION = '0.2.0';

/**
 * Smoke tests for the pkg-compiled native binaries. Run only when the .exe
 * files actually exist (after `npm run compile:win`). The e2e suite covers
 * the JS bundles; this layer validates the pkg-bundled artifacts.
 */
describe.skipIf(!existsSync(SERVICE_EXE))('compiled service binary', () => {
  it('service --version reports 0.2.0', () => {
    const output = execFileSync(SERVICE_EXE, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    expect(output.trim()).toBe(EXPECTED_VERSION);
  });
});

describe.skipIf(!existsSync(STUB_EXE))('compiled stub binary', () => {
  it('stub --version reports 0.2.0', () => {
    const output = execFileSync(STUB_EXE, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    expect(output.trim()).toBe(EXPECTED_VERSION);
  });
});
