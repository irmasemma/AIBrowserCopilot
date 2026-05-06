import { describe, it, expect } from 'vitest';
import {
  getStubAssetName,
  getServiceAssetName,
  getHelperAssetName,
  getStubDownloadUrl,
  getServiceDownloadUrl,
  getHelperDownloadUrl,
  GITHUB_RELEASES_BASE,
} from './constants.js';

describe('getStubAssetName', () => {
  it('returns Windows x64 exe', () => {
    expect(getStubAssetName('windows', 'x64')).toBe('ai-browser-copilot-stub-win-x64.exe');
  });

  it('returns Windows arm64 exe', () => {
    expect(getStubAssetName('windows', 'arm64')).toBe('ai-browser-copilot-stub-win-arm64.exe');
  });

  it('returns macOS x64 binary', () => {
    expect(getStubAssetName('macos', 'x64')).toBe('ai-browser-copilot-stub-macos-x64');
  });

  it('returns macOS arm64 binary', () => {
    expect(getStubAssetName('macos', 'arm64')).toBe('ai-browser-copilot-stub-macos-arm64');
  });

  it('returns Linux x64 binary', () => {
    expect(getStubAssetName('linux', 'x64')).toBe('ai-browser-copilot-stub-linux-x64');
  });

  it('returns Linux arm64 binary', () => {
    expect(getStubAssetName('linux', 'arm64')).toBe('ai-browser-copilot-stub-linux-arm64');
  });

  it('throws for unsupported combo', () => {
    expect(() => getStubAssetName('unknown' as any, 'x64')).toThrow('No stub binary available');
  });
});

describe('getServiceAssetName', () => {
  it('returns Windows x64 exe', () => {
    expect(getServiceAssetName('windows', 'x64')).toBe('ai-browser-copilot-service-win-x64.exe');
  });

  it('returns macOS arm64 binary', () => {
    expect(getServiceAssetName('macos', 'arm64')).toBe('ai-browser-copilot-service-macos-arm64');
  });

  it('throws for unsupported combo', () => {
    expect(() => getServiceAssetName('unknown' as any, 'x64')).toThrow('No service binary available');
  });
});

describe('getHelperAssetName', () => {
  it('returns Windows x64 helper exe', () => {
    expect(getHelperAssetName('windows', 'x64')).toBe('ai-browser-copilot-helper-win-x64.exe');
  });
});

describe('download URLs', () => {
  it('stub URL points at GitHub release', () => {
    expect(getStubDownloadUrl('windows', 'x64')).toBe(
      `${GITHUB_RELEASES_BASE}/ai-browser-copilot-stub-win-x64.exe`,
    );
  });

  it('service URL points at GitHub release', () => {
    expect(getServiceDownloadUrl('macos', 'arm64')).toBe(
      `${GITHUB_RELEASES_BASE}/ai-browser-copilot-service-macos-arm64`,
    );
  });

  it('helper URL points at GitHub release', () => {
    expect(getHelperDownloadUrl('linux', 'x64')).toBe(
      `${GITHUB_RELEASES_BASE}/ai-browser-copilot-helper-linux-x64`,
    );
  });
});
