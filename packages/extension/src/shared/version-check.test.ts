import { describe, it, expect } from 'vitest';
import { compareVersions, checkBridgeVersion, MIN_NATIVE_HOST_VERSION } from './version-check';

describe('compareVersions', () => {
  it('returns 0 for identical versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns -1 when a is older', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('returns 1 when a is newer', () => {
    expect(compareVersions('0.3.0', '0.2.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.99')).toBe(1);
  });

  it('handles different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareVersions('1.0.0-rc', '1.0.0')).toBe(0);
  });
});

describe('checkBridgeVersion', () => {
  it("returns 'ok' when installed equals minimum", () => {
    expect(checkBridgeVersion(MIN_NATIVE_HOST_VERSION)).toBe('ok');
  });

  it("returns 'ok' when installed is newer", () => {
    expect(checkBridgeVersion('0.3.0', '0.2.0')).toBe('ok');
    expect(checkBridgeVersion('1.0.0', '0.2.0')).toBe('ok');
  });

  it("returns 'outdated' when installed is older", () => {
    expect(checkBridgeVersion('0.1.9', '0.2.0')).toBe('outdated');
    expect(checkBridgeVersion('0.0.1', '0.2.0')).toBe('outdated');
  });

  it("returns 'outdated' when version is missing or empty", () => {
    expect(checkBridgeVersion(null)).toBe('outdated');
    expect(checkBridgeVersion(undefined)).toBe('outdated');
    expect(checkBridgeVersion('')).toBe('outdated');
  });
});
