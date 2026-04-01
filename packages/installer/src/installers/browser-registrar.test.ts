import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectBrowsers, registerForBrowser, HELPER_HOST_NAME } from './browser-registrar.js';
import { NATIVE_HOST_NAME } from '../shared/constants.js';
import type { PlatformInfo } from '../shared/platform.js';

const makePlatform = (os: 'windows' | 'macos' | 'linux'): PlatformInfo => ({
  os,
  arch: 'x64',
  homeDir: os === 'windows' ? 'C:\\Users\\test' : '/home/test',
  isSupported: true,
  displayName: `${os} x64`,
});

describe('browser-registrar', () => {
  describe('detectBrowsers', () => {
    it('returns browser list for macOS', () => {
      const browsers = detectBrowsers(makePlatform('macos'));
      const slugs = browsers.map((b) => b.slug);
      expect(slugs).toContain('chrome');
      expect(slugs).toContain('edge');
      expect(slugs).toContain('brave');
      expect(slugs).toContain('arc');
      expect(slugs).toContain('vivaldi');
    });

    it('excludes Arc on non-macOS platforms', () => {
      const browsers = detectBrowsers(makePlatform('windows'));
      expect(browsers.find((b) => b.slug === 'arc')).toBeUndefined();
    });

    it('returns browser list for Linux', () => {
      const browsers = detectBrowsers(makePlatform('linux'));
      const slugs = browsers.map((b) => b.slug);
      expect(slugs).toContain('chrome');
      expect(slugs).toContain('edge');
      expect(slugs).toContain('brave');
      expect(slugs).not.toContain('arc');
    });

    it('each browser has a manifestDir on macOS', () => {
      const browsers = detectBrowsers(makePlatform('macos'));
      for (const browser of browsers) {
        expect(browser.manifestDir).toBeTruthy();
        expect(browser.manifestDir).toContain('NativeMessagingHosts');
      }
    });

    it('each browser has a registryKey on Windows', () => {
      const browsers = detectBrowsers(makePlatform('windows'));
      for (const browser of browsers) {
        expect(browser.registryKey).toBeTruthy();
        expect(browser.registryKey).toContain('NativeMessagingHosts');
      }
    });
  });

  describe('HELPER_HOST_NAME', () => {
    it('is different from main host name', () => {
      expect(HELPER_HOST_NAME).not.toBe(NATIVE_HOST_NAME);
    });

    it('follows native messaging naming convention', () => {
      expect(HELPER_HOST_NAME).toMatch(/^[a-z][a-z0-9_.]+$/);
    });
  });

  describe('registerForBrowser', () => {
    it('returns error when no manifest dir on macOS', () => {
      const browser = { name: 'Unknown', slug: 'unknown', installed: false };
      const result = registerForBrowser(
        browser,
        makePlatform('macos'),
        NATIVE_HOST_NAME,
        'Test',
        '/path/to/binary',
        ['test-id'],
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No manifest dir');
    });

    it('returns error when no registry path on Windows', () => {
      const browser = { name: 'Unknown', slug: 'unknown', installed: false };
      const result = registerForBrowser(
        browser,
        makePlatform('windows'),
        NATIVE_HOST_NAME,
        'Test',
        '/path/to/binary',
        ['test-id'],
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No registry path');
    });
  });
});
