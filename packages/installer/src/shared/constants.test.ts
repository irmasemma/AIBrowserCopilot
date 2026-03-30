import { describe, it, expect } from 'vitest';
import { getAssetName, getDownloadUrl, GITHUB_RELEASES_BASE } from './constants.js';

describe('getAssetName', () => {
  it('returns Windows x64 exe', () => {
    expect(getAssetName('windows', 'x64')).toBe('ai-browser-copilot-win-x64.exe');
  });

  it('returns Windows arm64 exe', () => {
    expect(getAssetName('windows', 'arm64')).toBe('ai-browser-copilot-win-arm64.exe');
  });

  it('returns macOS x64 binary', () => {
    expect(getAssetName('macos', 'x64')).toBe('ai-browser-copilot-macos-x64');
  });

  it('returns macOS arm64 binary', () => {
    expect(getAssetName('macos', 'arm64')).toBe('ai-browser-copilot-macos-arm64');
  });

  it('returns Linux x64 binary', () => {
    expect(getAssetName('linux', 'x64')).toBe('ai-browser-copilot-linux-x64');
  });

  it('returns Linux arm64 binary', () => {
    expect(getAssetName('linux', 'arm64')).toBe('ai-browser-copilot-linux-arm64');
  });

  it('throws for unsupported combo', () => {
    expect(() => getAssetName('unknown' as any, 'x64')).toThrow('No binary available');
  });
});

describe('getDownloadUrl', () => {
  it('builds correct URL for macOS arm64', () => {
    expect(getDownloadUrl('macos', 'arm64')).toBe(
      `${GITHUB_RELEASES_BASE}/ai-browser-copilot-macos-arm64`,
    );
  });

  it('builds correct URL for Windows x64', () => {
    expect(getDownloadUrl('windows', 'x64')).toBe(
      `${GITHUB_RELEASES_BASE}/ai-browser-copilot-win-x64.exe`,
    );
  });
});
