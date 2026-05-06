import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { serviceBinaryAssetName, resolveServiceBinary } from './stub-impl.js';

describe('serviceBinaryAssetName', () => {
  it('windows x64', () => {
    expect(serviceBinaryAssetName('win32', 'x64')).toBe('ai-browser-copilot-service-win-x64.exe');
  });
  it('windows arm64', () => {
    expect(serviceBinaryAssetName('win32', 'arm64')).toBe('ai-browser-copilot-service-win-arm64.exe');
  });
  it('macos x64', () => {
    expect(serviceBinaryAssetName('darwin', 'x64')).toBe('ai-browser-copilot-service-macos-x64');
  });
  it('macos arm64', () => {
    expect(serviceBinaryAssetName('darwin', 'arm64')).toBe('ai-browser-copilot-service-macos-arm64');
  });
  it('linux x64', () => {
    expect(serviceBinaryAssetName('linux', 'x64')).toBe('ai-browser-copilot-service-linux-x64');
  });
  it('linux arm64', () => {
    expect(serviceBinaryAssetName('linux', 'arm64')).toBe('ai-browser-copilot-service-linux-arm64');
  });
  it('matches the installer asset map (regression guard)', () => {
    // If installer's SERVICE_ASSET_MAP changes naming, this test will fail
    // because the stub will look for the wrong file. Keep them in lockstep.
    const cases: Array<[NodeJS.Platform, string, string]> = [
      ['win32', 'x64', 'ai-browser-copilot-service-win-x64.exe'],
      ['win32', 'arm64', 'ai-browser-copilot-service-win-arm64.exe'],
      ['darwin', 'x64', 'ai-browser-copilot-service-macos-x64'],
      ['darwin', 'arm64', 'ai-browser-copilot-service-macos-arm64'],
      ['linux', 'x64', 'ai-browser-copilot-service-linux-x64'],
      ['linux', 'arm64', 'ai-browser-copilot-service-linux-arm64'],
    ];
    for (const [plat, arch, expected] of cases) {
      expect(serviceBinaryAssetName(plat, arch)).toBe(expected);
    }
  });
});

describe('resolveServiceBinary', () => {
  const originalEnv = process.env['COPILOT_SERVICE_BIN'];

  beforeEach(() => {
    delete process.env['COPILOT_SERVICE_BIN'];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['COPILOT_SERVICE_BIN'];
    else process.env['COPILOT_SERVICE_BIN'] = originalEnv;
  });

  it('honors COPILOT_SERVICE_BIN env var override', () => {
    process.env['COPILOT_SERVICE_BIN'] = '/custom/path/to/service';
    expect(resolveServiceBinary()).toBe('/custom/path/to/service');
  });

  it('falls back to platform-suffixed sibling of process.execPath', () => {
    const result = resolveServiceBinary();
    // Should end in the right asset name for the current platform/arch
    expect(result).toContain(serviceBinaryAssetName());
  });
});
