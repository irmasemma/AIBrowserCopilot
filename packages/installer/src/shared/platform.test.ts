import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { detectPlatform, getInstallDir, isNodeVersionSupported } from './platform.js';

describe('detectPlatform', () => {
  it('detects Windows x64', () => {
    const result = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    expect(result).toEqual({
      os: 'windows',
      arch: 'x64',
      homeDir: 'C:\\Users\\test',
      isSupported: true,
      displayName: 'Windows x64',
    });
  });

  it('detects Windows arm64', () => {
    const result = detectPlatform('win32', 'arm64', 'C:\\Users\\test');
    expect(result).toEqual({
      os: 'windows',
      arch: 'arm64',
      homeDir: 'C:\\Users\\test',
      isSupported: true,
      displayName: 'Windows arm64',
    });
  });

  it('detects macOS x64', () => {
    const result = detectPlatform('darwin', 'x64', '/Users/test');
    expect(result).toEqual({
      os: 'macos',
      arch: 'x64',
      homeDir: '/Users/test',
      isSupported: true,
      displayName: 'macOS x64',
    });
  });

  it('detects macOS arm64', () => {
    const result = detectPlatform('darwin', 'arm64', '/Users/test');
    expect(result).toEqual({
      os: 'macos',
      arch: 'arm64',
      homeDir: '/Users/test',
      isSupported: true,
      displayName: 'macOS arm64',
    });
  });

  it('detects Linux x64', () => {
    const result = detectPlatform('linux', 'x64', '/home/test');
    expect(result).toEqual({
      os: 'linux',
      arch: 'x64',
      homeDir: '/home/test',
      isSupported: true,
      displayName: 'Linux x64',
    });
  });

  it('detects Linux arm64', () => {
    const result = detectPlatform('linux', 'arm64', '/home/test');
    expect(result).toEqual({
      os: 'linux',
      arch: 'arm64',
      homeDir: '/home/test',
      isSupported: true,
      displayName: 'Linux arm64',
    });
  });

  it('marks unsupported platform', () => {
    const result = detectPlatform('freebsd', 'x64', '/home/test');
    expect(result.isSupported).toBe(false);
    expect(result.displayName).toContain('unsupported');
  });

  it('marks unsupported architecture', () => {
    const result = detectPlatform('linux', 'ia32', '/home/test');
    expect(result.isSupported).toBe(false);
    expect(result.displayName).toContain('unsupported');
  });
});

describe('getInstallDir', () => {
  it('returns Windows install dir using LOCALAPPDATA', () => {
    const original = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = 'C:\\Users\\test\\AppData\\Local';

    const platform = detectPlatform('win32', 'x64', 'C:\\Users\\test');
    const dir = getInstallDir(platform);
    expect(dir).toBe('C:\\Users\\test\\AppData\\Local\\ai-browser-copilot');

    if (original !== undefined) {
      process.env['LOCALAPPDATA'] = original;
    }
  });

  it('returns macOS install dir', () => {
    const platform = detectPlatform('darwin', 'arm64', '/Users/test');
    const dir = getInstallDir(platform);
    expect(dir).toBe(join('/Users/test', 'Library', 'Application Support', 'ai-browser-copilot'));
  });

  it('returns Linux install dir', () => {
    const platform = detectPlatform('linux', 'x64', '/home/test');
    const dir = getInstallDir(platform);
    expect(dir).toBe(join('/home/test', '.local', 'share', 'ai-browser-copilot'));
  });

  it('throws for unsupported platform', () => {
    const platform = detectPlatform('freebsd', 'x64', '/home/test');
    expect(() => getInstallDir(platform)).toThrow('Unsupported platform');
  });
});

describe('isNodeVersionSupported', () => {
  it('accepts Node 18', () => {
    expect(isNodeVersionSupported('v18.0.0')).toBe(true);
  });

  it('accepts Node 20', () => {
    expect(isNodeVersionSupported('v20.11.0')).toBe(true);
  });

  it('accepts Node 22', () => {
    expect(isNodeVersionSupported('v22.0.0')).toBe(true);
  });

  it('rejects Node 16', () => {
    expect(isNodeVersionSupported('v16.20.0')).toBe(false);
  });

  it('rejects Node 14', () => {
    expect(isNodeVersionSupported('v14.0.0')).toBe(false);
  });

  it('rejects Node 17', () => {
    expect(isNodeVersionSupported('v17.9.0')).toBe(false);
  });

  it('handles version without v prefix', () => {
    expect(isNodeVersionSupported('18.0.0')).toBe(true);
  });

  it('rejects invalid version string', () => {
    expect(isNodeVersionSupported('not-a-version')).toBe(false);
  });
});
