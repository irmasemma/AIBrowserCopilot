import { describe, it, expect } from 'vitest';
import { getAssetName, getDownloadUrl, GITHUB_REPO, GITHUB_RELEASES_BASE } from './constants.js';

describe('GITHUB_REPO', () => {
  it('points at the public release-assets repo (not the private source repo)', () => {
    // Critical: must NOT be the private `irmasemma/AIBrowserCopilot` source
    // repo — anonymous installer downloads from a private repo's release
    // assets return HTTP 404. The dedicated public `agenthub-releases`
    // repo holds compiled binaries only.
    expect(GITHUB_REPO).toBe('irmasemma/agenthub-releases');
  });
});

describe('getAssetName', () => {
  it('returns Windows x64 exe', () => {
    expect(getAssetName('windows', 'x64')).toBe('agenthub-win-x64.exe');
  });

  it('returns Windows arm64 exe', () => {
    expect(getAssetName('windows', 'arm64')).toBe('agenthub-win-arm64.exe');
  });

  it('returns macOS x64 binary', () => {
    expect(getAssetName('macos', 'x64')).toBe('agenthub-macos-x64');
  });

  it('returns macOS arm64 binary', () => {
    expect(getAssetName('macos', 'arm64')).toBe('agenthub-macos-arm64');
  });

  it('returns Linux x64 binary', () => {
    expect(getAssetName('linux', 'x64')).toBe('agenthub-linux-x64');
  });

  it('returns Linux arm64 binary', () => {
    expect(getAssetName('linux', 'arm64')).toBe('agenthub-linux-arm64');
  });

  it('throws for unsupported combo', () => {
    expect(() => getAssetName('unknown' as any, 'x64')).toThrow('No binary available');
  });
});

describe('getDownloadUrl', () => {
  it('builds correct URL for macOS arm64', () => {
    expect(getDownloadUrl('macos', 'arm64')).toBe(
      `${GITHUB_RELEASES_BASE}/agenthub-macos-arm64`,
    );
  });

  it('builds correct URL for Windows x64', () => {
    expect(getDownloadUrl('windows', 'x64')).toBe(
      `${GITHUB_RELEASES_BASE}/agenthub-win-x64.exe`,
    );
  });
});
