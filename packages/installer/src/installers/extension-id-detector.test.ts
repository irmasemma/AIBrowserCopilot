import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectExtensionIds } from './extension-id-detector.js';
import type { PlatformInfo } from '../shared/platform.js';

// macOS path layout keeps the test independent of process.env.LOCALAPPDATA.
const platform: PlatformInfo = { os: 'macos', arch: 'x64', homeDir: '', isSupported: true };

const AGENTHUB_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 chars a–p
const OTHER_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';

function writeProfile(home: string, profile: string, file: string, settings: Record<string, unknown>): void {
  const dir = join(home, 'Library', 'Application Support', 'Google', 'Chrome', profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify({ extensions: { settings } }), 'utf-8');
}

describe('detectExtensionIds', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ah-extdetect-')); platform.homeDir = home; });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  it('finds the AgentHub extension ID and ignores others', () => {
    writeProfile(home, 'Default', 'Secure Preferences', {
      [AGENTHUB_ID]: { manifest: { name: 'AgentHub — AI Chat + MCP' } },
      [OTHER_ID]: { manifest: { name: 'Some Other Extension' } },
    });
    expect(detectExtensionIds(platform)).toEqual([AGENTHUB_ID]);
  });

  it('dedupes the same ID across profiles and pref files', () => {
    writeProfile(home, 'Default', 'Secure Preferences', { [AGENTHUB_ID]: { manifest: { name: 'AgentHub' } } });
    writeProfile(home, 'Profile 1', 'Preferences', { [AGENTHUB_ID]: { manifest: { name: 'AgentHub' } } });
    expect(detectExtensionIds(platform)).toEqual([AGENTHUB_ID]);
  });

  it('returns multiple IDs when distinct AgentHub installs exist', () => {
    writeProfile(home, 'Default', 'Secure Preferences', { [AGENTHUB_ID]: { manifest: { name: 'AgentHub' } } });
    writeProfile(home, 'Profile 2', 'Secure Preferences', { [OTHER_ID]: { manifest: { name: 'AgentHub (dev)' } } });
    expect(detectExtensionIds(platform).sort()).toEqual([AGENTHUB_ID, OTHER_ID].sort());
  });

  it('returns [] when nothing matches', () => {
    writeProfile(home, 'Default', 'Secure Preferences', { [OTHER_ID]: { manifest: { name: 'Unrelated' } } });
    expect(detectExtensionIds(platform)).toEqual([]);
  });

  it('never throws on malformed preferences', () => {
    const dir = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Secure Preferences'), '{ not valid json', 'utf-8');
    expect(() => detectExtensionIds(platform)).not.toThrow();
    expect(detectExtensionIds(platform)).toEqual([]);
  });

  it('ignores entries whose key is not a valid extension ID', () => {
    writeProfile(home, 'Default', 'Secure Preferences', { 'not-a-real-id': { manifest: { name: 'AgentHub' } } });
    expect(detectExtensionIds(platform)).toEqual([]);
  });
});
