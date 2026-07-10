// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { detectAndExtractData } from './data-detector.js';

// jsdom in this test environment doesn't implement CSS.escape (it's a real
// browser/Chrome-extension API that IS present at runtime — MV3 content
// scripts run in an actual Chromium renderer). Minimal polyfill so
// selectorFor()/extractFieldsFromPattern() (which call CSS.escape) don't
// throw under test; this only affects test infra, not the tested logic.
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  (globalThis as any).CSS = {
    ...(globalThis as any).CSS,
    escape: (s: string) => String(s).replace(/([^\w-])/g, '\\$1'),
  };
}

describe('detectAndExtractData — classic shared-className repeating pattern (regression lock)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a repeating pattern when siblings share an exact tag+className (pass 1, no fallback needed)', () => {
    document.body.innerHTML = `
      <div id="list">
        <div class="card"><div>Widget A</div><div>${'x'.repeat(150)}</div></div>
        <div class="card"><div>Widget B</div><div>${'y'.repeat(150)}</div></div>
        <div class="card"><div>Widget C</div><div>${'z'.repeat(150)}</div></div>
      </div>
    `;

    const result = detectAndExtractData({});
    expect(result.bestRegion).not.toBeNull();
    expect(result.bestRegion!.source).toBe('repeating_pattern');
    expect(result.bestRegion!.totalDetected).toBe(3);
  });
});

describe('detectAndExtractData — tag-only fallback (INVERSE of the className-match assumption)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Real incident: Threads (Meta stylex/atomic CSS) gives every sibling card a
  // near-unique className, so `tag+className` grouping (the ONLY strategy
  // before this fix) collapses every group to size 1 and `extract_data` always
  // reported "No structured data detected" — even though the page visibly has
  // a repeating feed. This reproduces that DOM shape.
  it('finds a repeating pattern when siblings share a tag but each has a UNIQUE className (Threads/stylex shape)', () => {
    document.body.innerHTML = `
      <div id="feed">
        <div class="x1a2b3c4d">
          <div>Alice</div>
          <div>${'a'.repeat(150)}</div>
        </div>
        <div class="y9z8w7q6r">
          <div>Bob</div>
          <div>${'b'.repeat(150)}</div>
        </div>
        <div class="m2n3o4p5q">
          <div>Carol</div>
          <div>${'c'.repeat(150)}</div>
        </div>
      </div>
    `;

    const result = detectAndExtractData({});
    expect(result.bestRegion).not.toBeNull();
    expect(result.bestRegion!.source).toBe('repeating_pattern');
    expect(result.bestRegion!.totalDetected).toBe(3);
  });

  it('genuinely has nothing to find still reports no bestRegion (fallback does not manufacture false positives)', () => {
    document.body.innerHTML = `
      <div id="empty">
        <div class="unique-a">Just one</div>
        <p>Some unrelated paragraph text that is not part of any repeating structure.</p>
      </div>
    `;

    const result = detectAndExtractData({});
    expect(result.bestRegion).toBeNull();
  });
});

describe('detectAndExtractData — cell text truncation (no unbounded field)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('caps a single cell/item text at 500 chars even inside a detected pattern', () => {
    const huge = 'q'.repeat(5000);
    document.body.innerHTML = `
      <div id="feed">
        <div class="card"><div>${huge}</div></div>
        <div class="card"><div>${huge}</div></div>
        <div class="card"><div>${huge}</div></div>
      </div>
    `;

    const result = detectAndExtractData({});
    expect(result.bestRegion).not.toBeNull();
    for (const row of result.bestRegion!.rows) {
      for (const cell of row) {
        expect(cell.length).toBeLessThanOrEqual(500);
      }
    }
  });
});
