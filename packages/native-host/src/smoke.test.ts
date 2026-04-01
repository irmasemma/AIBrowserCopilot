import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BINARY_PATH = join(__dirname, '..', 'bin', 'ai-browser-copilot-win-x64.exe');

/**
 * Smoke tests for the compiled binary.
 * Only tests that don't interfere with running instances.
 * The full startup test is done manually or in CI where no MCP server is running.
 */
describe('compiled binary smoke test', () => {
  it('binary exists', () => {
    expect(existsSync(BINARY_PATH)).toBe(true);
  });

  it('--version outputs correct version', () => {
    const output = execFileSync(BINARY_PATH, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    expect(output.trim()).toBe('0.1.0');
  });
});
