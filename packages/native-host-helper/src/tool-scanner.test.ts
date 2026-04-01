import { describe, it, expect } from 'vitest';
import { scanAITools, type ToolScanResult } from './tool-scanner.js';

describe('tool-scanner', () => {
  describe('scanAITools', () => {
    it('returns an array of 8 ToolScanResult objects', () => {
      const results = scanAITools();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(8);
      for (const r of results) {
        expect(r).toHaveProperty('tool');
        expect(r).toHaveProperty('slug');
        expect(r).toHaveProperty('installed');
        expect(r).toHaveProperty('configured');
        expect(r).toHaveProperty('configPath');
        expect(typeof r.tool).toBe('string');
        expect(typeof r.slug).toBe('string');
        expect(typeof r.installed).toBe('boolean');
        expect(typeof r.configured).toBe('boolean');
        expect(typeof r.configPath).toBe('string');
      }
    });

    it('includes all expected tool slugs', () => {
      const results = scanAITools();
      const slugs = results.map(r => r.slug);
      expect(slugs).toContain('claude-desktop');
      expect(slugs).toContain('claude-code');
      expect(slugs).toContain('vscode');
      expect(slugs).toContain('cursor');
      expect(slugs).toContain('windsurf');
      expect(slugs).toContain('jetbrains');
      expect(slugs).toContain('zed');
      expect(slugs).toContain('continue');
    });

    it('returns installed:false and configured:false for missing config files', () => {
      const results = scanAITools();
      for (const r of results) {
        if (!r.installed) {
          expect(r.configured).toBe(false);
        }
      }
    });

    it('returns non-empty configPath for every tool', () => {
      const results = scanAITools();
      for (const r of results) {
        expect(r.configPath.length).toBeGreaterThan(0);
      }
    });
  });
});
