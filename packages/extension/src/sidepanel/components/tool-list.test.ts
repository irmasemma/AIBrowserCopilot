import { describe, it, expect } from 'vitest';
import { getToolStatus, getToolStatusLabel, getToolStatusIcon } from './tool-list.js';
import type { ToolScanResult } from '../../shared/types.js';

const tool = (slug: string, installed: boolean, configured: boolean): ToolScanResult => ({
  tool: slug.charAt(0).toUpperCase() + slug.slice(1),
  slug,
  installed,
  configured,
  configPath: `/path/${slug}`,
});

describe('tool-list', () => {
  describe('getToolStatus', () => {
    it('returns "active" when tool is configured and matches activeSlug', () => {
      expect(getToolStatus(tool('claude-code', true, true), 'claude-code')).toBe('active');
    });

    it('returns "configured" when tool is configured but not active', () => {
      expect(getToolStatus(tool('vscode', true, true), 'claude-code')).toBe('configured');
    });

    it('returns "unconfigured" when tool is not configured', () => {
      expect(getToolStatus(tool('cursor', true, false), 'claude-code')).toBe('unconfigured');
    });

    it('returns "configured" when no activeSlug', () => {
      expect(getToolStatus(tool('vscode', true, true), null)).toBe('configured');
    });
  });

  describe('getToolStatusLabel', () => {
    it('returns correct labels', () => {
      expect(getToolStatusLabel('active')).toBe('connected');
      expect(getToolStatusLabel('configured')).toBe('configured');
      expect(getToolStatusLabel('unconfigured')).toBe('not configured');
    });
  });

  describe('getToolStatusIcon', () => {
    it('returns correct icons', () => {
      expect(getToolStatusIcon('active')).toBe('✅');
      expect(getToolStatusIcon('configured')).toBe('✓');
      expect(getToolStatusIcon('unconfigured')).toBe('⚠️');
    });
  });
});
