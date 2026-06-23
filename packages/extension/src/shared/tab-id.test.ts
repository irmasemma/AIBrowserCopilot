import { describe, it, expect } from 'vitest';
import { composeTabId, parseTabId } from './tab-id';

describe('composeTabId', () => {
  it('joins browserId and raw id with a colon', () => {
    expect(composeTabId('chrome:abc-123', 622786441)).toBe('chrome:abc-123:622786441');
  });

  it('handles legacy brand-only browserIds', () => {
    expect(composeTabId('chrome', 1)).toBe('chrome:1');
  });
});

describe('parseTabId', () => {
  it('parses a namespaced composite tab id', () => {
    expect(parseTabId('chrome:abc-123:622786441')).toEqual({
      browserId: 'chrome:abc-123',
      rawId: 622786441,
    });
  });

  it('parses a brand-only namespaced id', () => {
    expect(parseTabId('chrome:1')).toEqual({ browserId: 'chrome', rawId: 1 });
  });

  it('parses a raw integer (legacy form)', () => {
    expect(parseTabId(622786441)).toEqual({ browserId: '', rawId: 622786441 });
  });

  it('parses a numeric string (legacy form)', () => {
    expect(parseTabId('622786441')).toEqual({ browserId: '', rawId: 622786441 });
  });

  it('returns null for empty input', () => {
    expect(parseTabId('')).toBeNull();
    expect(parseTabId(null)).toBeNull();
    expect(parseTabId(undefined)).toBeNull();
  });

  it('returns null when the suffix after the last colon is not numeric', () => {
    expect(parseTabId('chrome:abc:notnum')).toBeNull();
  });

  it('returns null when input ends with a colon (no raw id)', () => {
    expect(parseTabId('chrome:abc:')).toBeNull();
  });

  it('returns null for non-string non-number input', () => {
    expect(parseTabId({})).toBeNull();
    expect(parseTabId([])).toBeNull();
    expect(parseTabId(true)).toBeNull();
  });

  it('round-trips compose then parse for composite ids', () => {
    const composed = composeTabId('chrome:profile-A', 999);
    expect(parseTabId(composed)).toEqual({ browserId: 'chrome:profile-A', rawId: 999 });
  });

  it('handles browserIds containing multiple colons (parses on the LAST one)', () => {
    // Defensive: if a brand or uuid ever contained a colon, the last-colon
    // rule still extracts the rawId correctly.
    expect(parseTabId('chrome:a:b:42')).toEqual({ browserId: 'chrome:a:b', rawId: 42 });
  });
});
