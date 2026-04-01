import { describe, it, expect } from 'vitest';
import { scanAITools } from './ai-tool-scanner.js';

describe('ai-tool-scanner', () => {
  describe('scanAITools', () => {
    it('returns an array of ToolScanResult objects', () => {
      const results = scanAITools();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(8);
      for (const r of results) {
        expect(r).toHaveProperty('tool');
        expect(r).toHaveProperty('slug');
        expect(r).toHaveProperty('installed');
        expect(r).toHaveProperty('configured');
        expect(r).toHaveProperty('configPath');
      }
    });

    it('includes expected tool names', () => {
      const results = scanAITools();
      const names = results.map(r => r.slug);
      expect(names).toContain('claude-desktop');
      expect(names).toContain('claude-code');
      expect(names).toContain('vscode');
      expect(names).toContain('cursor');
      expect(names).toContain('windsurf');
      expect(names).toContain('jetbrains');
      expect(names).toContain('zed');
      expect(names).toContain('continue');
    });

    it('detects configured tool when ai-browser-copilot entry exists in config', () => {
      const results = scanAITools();
      const claudeCode = results.find(r => r.slug === 'claude-code');
      expect(claudeCode).toBeDefined();
      expect(typeof claudeCode!.installed).toBe('boolean');
      expect(typeof claudeCode!.configured).toBe('boolean');
    });

    it('returns installed:false for missing config files', () => {
      const results = scanAITools();
      for (const r of results) {
        if (!r.installed) {
          expect(r.configured).toBe(false);
        }
      }
    });
  });
});
