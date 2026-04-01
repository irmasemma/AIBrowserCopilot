import { describe, it, expect } from 'vitest';
import {
  getUnconfiguredTools,
  getConfiguredTools,
  getNewUnconfiguredTools,
  processScanResults,
  createInitialScanState,
} from './tool-scanner.js';
import type { ToolScanResult } from '../shared/types.js';

const tool = (slug: string, installed: boolean, configured: boolean): ToolScanResult => ({
  tool: slug,
  slug,
  installed,
  configured,
  configPath: `/path/to/${slug}`,
});

describe('tool-scanner', () => {
  describe('getUnconfiguredTools', () => {
    it('returns tools that are installed but not configured', () => {
      const results = [
        tool('claude-code', true, true),
        tool('cursor', true, false),
        tool('windsurf', false, false),
      ];
      const unconfigured = getUnconfiguredTools(results);
      expect(unconfigured).toHaveLength(1);
      expect(unconfigured[0].slug).toBe('cursor');
    });

    it('returns empty array when all installed tools are configured', () => {
      const results = [
        tool('claude-code', true, true),
        tool('vscode', true, true),
      ];
      expect(getUnconfiguredTools(results)).toHaveLength(0);
    });

    it('returns empty array when no tools are installed', () => {
      const results = [
        tool('windsurf', false, false),
        tool('zed', false, false),
      ];
      expect(getUnconfiguredTools(results)).toHaveLength(0);
    });
  });

  describe('getConfiguredTools', () => {
    it('returns tools that are installed and configured', () => {
      const results = [
        tool('claude-code', true, true),
        tool('cursor', true, false),
        tool('vscode', true, true),
      ];
      const configured = getConfiguredTools(results);
      expect(configured).toHaveLength(2);
      expect(configured.map((t) => t.slug)).toEqual(['claude-code', 'vscode']);
    });
  });

  describe('getNewUnconfiguredTools', () => {
    it('returns tools that are newly unconfigured (not in previous scan)', () => {
      const prev = [tool('cursor', true, false)];
      const curr = [
        tool('cursor', true, false),
        tool('windsurf', true, false),
      ];
      const newTools = getNewUnconfiguredTools(curr, prev);
      expect(newTools).toHaveLength(1);
      expect(newTools[0].slug).toBe('windsurf');
    });

    it('returns empty when nothing is new', () => {
      const prev = [tool('cursor', true, false)];
      const curr = [tool('cursor', true, false)];
      expect(getNewUnconfiguredTools(curr, prev)).toHaveLength(0);
    });

    it('returns all unconfigured when previous is empty', () => {
      const prev: ToolScanResult[] = [];
      const curr = [tool('cursor', true, false), tool('vscode', true, false)];
      expect(getNewUnconfiguredTools(curr, prev)).toHaveLength(2);
    });

    it('ignores tools that became configured', () => {
      const prev = [tool('cursor', true, false)];
      const curr = [tool('cursor', true, true)]; // now configured
      expect(getNewUnconfiguredTools(curr, prev)).toHaveLength(0);
    });
  });

  describe('processScanResults', () => {
    it('moves current to previous and sets new current', () => {
      const state = createInitialScanState();
      const results = [tool('claude-code', true, true)];
      const next = processScanResults(state, results);
      expect(next.current).toEqual(results);
      expect(next.previous).toEqual([]);
      expect(next.timestamp).toBeGreaterThan(0);
    });

    it('preserves previous scan as the old current', () => {
      const first = [tool('claude-code', true, true)];
      const second = [tool('claude-code', true, true), tool('cursor', true, false)];

      let state = createInitialScanState();
      state = processScanResults(state, first);
      state = processScanResults(state, second);

      expect(state.current).toEqual(second);
      expect(state.previous).toEqual(first);
    });
  });
});
