import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAllowedExtensionIds, ALLOWED_IDS_FILENAME } from './allowed-ids-writer.js';

const TEST_DIR = join(tmpdir(), `agenthub-allowed-ids-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('writeAllowedExtensionIds', () => {
  it('writes a JSON array of IDs to the config path', () => {
    const path = join(TEST_DIR, ALLOWED_IDS_FILENAME);
    const r = writeAllowedExtensionIds(path, ['abc123', 'def456']);
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(['abc123', 'def456']);
  });

  it('creates the install dir if it does not exist', () => {
    const nested = join(TEST_DIR, 'fresh-install');
    const path = join(nested, ALLOWED_IDS_FILENAME);
    const r = writeAllowedExtensionIds(path, ['abc123']);
    expect(r.ok).toBe(true);
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('trims and dedupes IDs, dropping empties', () => {
    const path = join(TEST_DIR, ALLOWED_IDS_FILENAME);
    writeAllowedExtensionIds(path, ['  abc  ', 'abc', '', ' def ']);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(['abc', 'def']);
  });

  it('returns ok=false when no valid IDs are provided', () => {
    const path = join(TEST_DIR, ALLOWED_IDS_FILENAME);
    const r = writeAllowedExtensionIds(path, ['', '   ', '']);
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
    expect(existsSync(path)).toBe(false);
  });

  it('overwrites an existing file (does not append) — fresh installs replace stale IDs', () => {
    const path = join(TEST_DIR, ALLOWED_IDS_FILENAME);
    writeFileSync(path, JSON.stringify(['stale1', 'stale2']));
    writeAllowedExtensionIds(path, ['fresh-only']);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(['fresh-only']);
  });

  it('writes JSON the bridge can round-trip', () => {
    // Mirror service.ts:loadAllowedExtensionIds parsing — verify the file
    // we write is in the exact shape the bridge expects.
    const path = join(TEST_DIR, ALLOWED_IDS_FILENAME);
    writeAllowedExtensionIds(path, ['real-extension-id-here']);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.every((s: unknown) => typeof s === 'string')).toBe(true);
  });
});
