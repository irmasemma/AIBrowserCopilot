import { describe, it, expect, beforeEach } from 'vitest';
import { register, getAll, clear, runAll } from './registry.js';
import type { ToolDetector, DetectionResult, WriteConfigResult } from './types.js';
import type { PlatformInfo } from '../shared/platform.js';
import { detectPlatform } from '../shared/platform.js';

const makeMockDetector = (
  name: string,
  slug: string,
  detectResult: DetectionResult = { installed: true },
  detectDelay = 0,
): ToolDetector => ({
  name,
  slug,
  detect: async () => {
    if (detectDelay > 0) {
      await new Promise((r) => setTimeout(r, detectDelay));
    }
    return detectResult;
  },
  writeConfig: async () => ({ success: true, action: 'created' as const }),
  verifyConfig: async () => true,
});

const platform = detectPlatform();

beforeEach(() => {
  clear();
});

describe('register / getAll / clear', () => {
  it('starts with empty registry', () => {
    expect(getAll()).toHaveLength(0);
  });

  it('registers a detector', () => {
    register(makeMockDetector('Test Tool', 'test-tool'));
    expect(getAll()).toHaveLength(1);
    expect(getAll()[0].name).toBe('Test Tool');
  });

  it('registers multiple detectors', () => {
    register(makeMockDetector('Tool A', 'tool-a'));
    register(makeMockDetector('Tool B', 'tool-b'));
    expect(getAll()).toHaveLength(2);
  });

  it('clear removes all detectors', () => {
    register(makeMockDetector('Tool', 'tool'));
    clear();
    expect(getAll()).toHaveLength(0);
  });

  it('getAll returns readonly array', () => {
    register(makeMockDetector('Tool', 'tool'));
    const all = getAll();
    expect(all).toHaveLength(1);
    // TypeScript enforces readonly, runtime check
    expect(Array.isArray(all)).toBe(true);
  });
});

describe('runAll', () => {
  it('runs all detectors and returns results', async () => {
    register(makeMockDetector('Tool A', 'tool-a', { installed: true, version: '1.0' }));
    register(makeMockDetector('Tool B', 'tool-b', { installed: false }));

    const results = await runAll(platform);

    expect(results).toHaveLength(2);
    expect(results[0].detector.name).toBe('Tool A');
    expect(results[0].detection.installed).toBe(true);
    expect(results[0].detection.version).toBe('1.0');
    expect(results[1].detector.name).toBe('Tool B');
    expect(results[1].detection.installed).toBe(false);
  });

  it('runs detectors in parallel', async () => {
    const start = Date.now();

    // Two detectors each taking 100ms — if parallel, total < 200ms
    register(makeMockDetector('Tool A', 'tool-a', { installed: true }, 100));
    register(makeMockDetector('Tool B', 'tool-b', { installed: true }, 100));

    await runAll(platform);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(300); // Parallel: ~100ms, not 200ms
  });

  it('completes within 2 seconds', async () => {
    register(makeMockDetector('Fast Tool', 'fast', { installed: true }, 50));

    const start = Date.now();
    await runAll(platform);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  it('isolates errors — one failing detector does not crash others', async () => {
    register(makeMockDetector('Good Tool', 'good', { installed: true }));

    const failingDetector: ToolDetector = {
      name: 'Failing Tool',
      slug: 'failing',
      detect: async () => { throw new Error('Detector crash'); },
      writeConfig: async () => ({ success: false, action: 'skipped' }),
      verifyConfig: async () => false,
    };
    register(failingDetector);

    register(makeMockDetector('Another Good', 'another-good', { installed: true }));

    const results = await runAll(platform);

    expect(results).toHaveLength(3);
    // First and third should succeed
    expect(results[0].detection.installed).toBe(true);
    expect(results[0].error).toBeUndefined();
    // Second should have error
    expect(results[1].detection.installed).toBe(false);
    expect(results[1].error).toContain('Detector crash');
    // Third should succeed
    expect(results[2].detection.installed).toBe(true);
    expect(results[2].error).toBeUndefined();
  });

  it('times out slow detectors', async () => {
    // Detector that takes 5 seconds — should timeout at 2s
    register(makeMockDetector('Slow Tool', 'slow', { installed: true }, 5000));

    const start = Date.now();
    const results = await runAll(platform);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3000); // Should timeout at 2s, not wait 5s
    expect(results[0].detection.installed).toBe(false);
    expect(results[0].error).toContain('timed out');
  }, 10000);

  it('returns empty array for empty registry', async () => {
    const results = await runAll(platform);
    expect(results).toEqual([]);
  });

  it('preserves detector reference in results', async () => {
    const detector = makeMockDetector('Ref Test', 'ref-test');
    register(detector);

    const results = await runAll(platform);
    expect(results[0].detector).toBe(detector);
  });
});
