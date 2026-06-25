import { describe, it, expect } from 'vitest';
import {
  deriveVerdict,
  extractApiStateFacts,
  FLAPPING_SUPERSEDE_THRESHOLD,
  type ApiStateFacts,
  type DeriveVerdictArgs,
} from './connection-verdict';

const STALE_MS = 40_000;

const liveFacts: ApiStateFacts = {
  liveness: 'live',
  lastSeenAgeSec: 1,
  supersededCount: 0,
  lastRelayCloseCode: null,
  hadRecentSuccess: false,
  hadRecentFailure: false,
  hadRecentReplacedMidRequest: false,
};

function args(over: Omit<Partial<DeriveVerdictArgs>, 'ctx'> & { ctx?: Partial<DeriveVerdictArgs['ctx']> }): DeriveVerdictArgs {
  return {
    ctx: {
      state: 'connected',
      diagnosticReason: null,
      failureCount: 0,
      lastConnectedAt: Date.now(),
      reconnectsThisSession: 0,
      lastVerifiedAt: Date.now(),
      versionStatus: null,
      ...over.ctx,
    },
    api: over.api ?? null,
    quickCheckPassed: over.quickCheckPassed ?? false,
    reconnectingSinceMs: over.reconnectingSinceMs ?? null,
    staleThresholdMs: STALE_MS,
  };
}

describe('deriveVerdict — Working requires a tool-path fact, never a pong', () => {
  it('connected, no facts → untested (NOT working)', () => {
    const v = deriveVerdict(args({ api: null }));
    expect(v.kind).toBe('untested');
    expect(v.title).toBe('Connected — not yet tested');
    expect(v.actions[0]?.id).toBe('run_quick_check');
  });

  it('connected, fresh lastVerifiedAt (a pong just arrived) but no /api/state → still untested', () => {
    // The CORE of the lie: a recent pong bumps lastVerifiedAt but proves nothing
    // about the tool path. Must not upgrade to working.
    const v = deriveVerdict(args({ ctx: { lastVerifiedAt: Date.now() }, api: null }));
    expect(v.kind).toBe('untested');
  });

  it('connected + real recent success → working', () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, hadRecentSuccess: true } }));
    expect(v.kind).toBe('working');
  });

  it('connected + liveness live + flat supersede → working', () => {
    const v = deriveVerdict(args({ api: liveFacts }));
    expect(v.kind).toBe('working');
  });

  it('connected + quickCheckPassed → working without /api/state', () => {
    const v = deriveVerdict(args({ api: null, quickCheckPassed: true }));
    expect(v.kind).toBe('working');
  });

  it('a recent failure blocks working even if a success also exists', () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, hadRecentSuccess: true, hadRecentFailure: true } }));
    expect(v.kind).toBe('untested');
  });
});

describe('deriveVerdict — Flapping from bridge supersede rate', () => {
  it(`supersededCount ≥ ${FLAPPING_SUPERSEDE_THRESHOLD} → flapping, Restart bridge`, () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, supersededCount: FLAPPING_SUPERSEDE_THRESHOLD } }));
    expect(v.kind).toBe('flapping');
    expect(v.title).toBe('Connection keeps dropping');
    expect(v.actions[0]?.label).toBe('Restart bridge');
  });

  it('a replaced-mid-request failure → flapping', () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, hadRecentFailure: true, hadRecentReplacedMidRequest: true } }));
    expect(v.kind).toBe('flapping');
  });

  it('reconnectsThisSession only fires flapping when /api/state is absent (secondary)', () => {
    expect(deriveVerdict(args({ api: null, ctx: { reconnectsThisSession: 3 } })).kind).toBe('flapping');
    // With healthy /api/state present, the stale client counter must NOT win.
    expect(
      deriveVerdict(args({ api: { ...liveFacts, hadRecentSuccess: true }, ctx: { reconnectsThisSession: 9 } })).kind,
    ).toBe('working');
  });
});

describe('deriveVerdict — Recovering (awaiting_sw_recovery) never reads Connected', () => {
  it('awaiting_sw_recovery → recovering, distinct badge, Reconnect now', () => {
    const v = deriveVerdict(args({ ctx: { state: 'reconnecting', diagnosticReason: 'awaiting_sw_recovery' } }));
    expect(v.kind).toBe('recovering');
    expect(v.badge).toBe('recovering');
    expect(v.title).toBe('Reconnecting to your browser');
    expect(v.actions[0]?.id).toBe('reconnect_now');
  });

  it('wins over a connected state + healthy facts (no lying green during the dead-window)', () => {
    const v = deriveVerdict(
      args({ ctx: { state: 'connected', diagnosticReason: 'awaiting_sw_recovery' }, api: { ...liveFacts, hadRecentSuccess: true } }),
    );
    expect(v.kind).toBe('recovering');
    expect(v.badge).not.toBe('working');
  });
});

describe('deriveVerdict — stale + degraded', () => {
  it('liveness stale → stale verdict (bridge truth)', () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, liveness: 'stale' } }));
    expect(v.kind).toBe('stale');
    expect(v.title).toBe('Connection went quiet');
  });

  it('no /api/state + lastVerifiedAt aged past threshold → stale fallback', () => {
    const v = deriveVerdict(args({ api: null, ctx: { lastVerifiedAt: Date.now() - STALE_MS - 1 } }));
    expect(v.kind).toBe('stale');
  });

  it('degraded state with no staleness → degraded', () => {
    const v = deriveVerdict(args({ ctx: { state: 'degraded', lastVerifiedAt: Date.now() }, api: null }));
    expect(v.kind).toBe('degraded');
  });
});

describe('extractApiStateFacts', () => {
  const now = Date.parse('2026-06-25T12:00:00.000Z');
  const mkPayload = (over: { requests?: unknown[]; browsersExtra?: Record<string, unknown> } = {}) => ({
    browsers: [
      {
        browserId: 'chrome:me',
        liveness: 'live' as const,
        lastSeenAgeSec: 3,
        supersededCount: 0,
        lastRelayCloseCode: null,
        ...over.browsersExtra,
      },
    ],
    recentActivity: { requests: (over.requests ?? []) as never },
  });

  it('returns null when our browserId is absent (do not borrow another browser liveness)', () => {
    const facts = extractApiStateFacts(mkPayload(), 'chrome:someone-else', now);
    expect(facts).toBeNull();
  });

  it('maps liveness + supersededCount for our browserId', () => {
    const facts = extractApiStateFacts(mkPayload({ browsersExtra: { supersededCount: 5, liveness: 'stale' } }), 'chrome:me', now);
    expect(facts?.supersededCount).toBe(5);
    expect(facts?.liveness).toBe('stale');
  });

  it('detects recent success + the replaced-mid-request signature', () => {
    const facts = extractApiStateFacts(
      mkPayload({
        requests: [
          { browserId: 'chrome:me', status: 'success', startedAt: '2026-06-25T11:59:58.000Z', finishedAt: '2026-06-25T11:59:59.000Z' },
          {
            browserId: 'chrome:me',
            status: 'error',
            startedAt: '2026-06-25T11:59:58.000Z',
            finishedAt: '2026-06-25T11:59:59.500Z',
            errorMessage: 'browser_socket_replaced_mid_request',
          },
        ],
      }),
      'chrome:me',
      now,
    );
    expect(facts?.hadRecentSuccess).toBe(true);
    expect(facts?.hadRecentFailure).toBe(true);
    expect(facts?.hadRecentReplacedMidRequest).toBe(true);
  });

  it('ignores requests for OTHER browserIds and stale (out-of-window) requests', () => {
    const facts = extractApiStateFacts(
      mkPayload({
        requests: [
          { browserId: 'chrome:other', status: 'success', startedAt: '2026-06-25T11:59:59.000Z', finishedAt: '2026-06-25T11:59:59.000Z' },
          { browserId: 'chrome:me', status: 'success', startedAt: '2026-06-25T11:50:00.000Z', finishedAt: '2026-06-25T11:50:00.000Z' },
        ],
      }),
      'chrome:me',
      now,
    );
    expect(facts?.hadRecentSuccess).toBe(false);
  });
});
