import { describe, it, expect } from 'vitest';
import { mcpTabNeedsAttention, ATTENTION_KINDS } from './mcp-tab-attention';

describe('mcpTabNeedsAttention', () => {
  it('never badges a user who has never engaged MCP, even on an error verdict', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: false, severity: 'error', kind: 'broken' }),
    ).toBe(false);
  });

  it('badges an engaged user on an actionable failure kind (broken)', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'error', kind: 'broken' }),
    ).toBe(true);
  });

  it('does NOT badge on the benign "untested" kind even when engaged + non-ok severity', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'warn', kind: 'untested' }),
    ).toBe(false);
  });

  it('badges on "flapping" for an engaged user', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'error', kind: 'flapping' }),
    ).toBe(true);
  });

  it('does NOT badge on "working" / severity "ok"', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'ok', kind: 'working' }),
    ).toBe(false);
  });

  it('does NOT badge when severity is ok regardless of kind', () => {
    expect(
      mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'ok', kind: 'stale' }),
    ).toBe(false);
  });

  it('every actionable kind badges; every benign kind does not', () => {
    const benign = ['untested', 'connecting', 'working'] as const;
    for (const kind of benign) {
      expect(ATTENTION_KINDS.has(kind)).toBe(false);
    }
    for (const kind of ATTENTION_KINDS) {
      expect(
        mcpTabNeedsAttention({ hasEngagedMcp: true, severity: 'error', kind }),
      ).toBe(true);
    }
  });
});
