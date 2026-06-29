import { describe, it, expect } from 'vitest';
import {
  deriveVerdict,
  detectVersionSkew,
  buildUpdateCommand,
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
  supersededRecentCount: 0,
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

describe('deriveVerdict — Flapping from bridge supersede RATE (not a lifetime count)', () => {
  it(`supersededRecentCount ≥ ${FLAPPING_SUPERSEDE_THRESHOLD} → flapping, Restart bridge`, () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, supersededRecentCount: FLAPPING_SUPERSEDE_THRESHOLD } }));
    expect(v.kind).toBe('flapping');
    expect(v.title).toBe('Connection keeps dropping');
    expect(v.actions[0]?.label).toBe('Restart bridge');
  });

  it('a high CUMULATIVE supersededCount but FLAT recent rate + recent success → working, NOT flapping', () => {
    // Regression for the post-convergence lie: the storm this fix targets drives
    // the lifetime supersededCount sky-high, then converges. The cumulative count
    // stays high for the life of the bridge, but the RATE decays to 0 — so the
    // verdict must self-heal to "working", never sit on "keeps dropping" forever.
    const v = deriveVerdict(args({
      api: { ...liveFacts, supersededCount: 500, supersededRecentCount: 0, hadRecentSuccess: true },
    }));
    expect(v.kind).toBe('working');
  });

  it('a high cumulative count alone (flat rate, no recent fact) → untested, NOT flapping', () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, liveness: 'unknown', supersededCount: 500, supersededRecentCount: 0 } }));
    expect(v.kind).not.toBe('flapping');
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

describe('buildUpdateCommand — always-visible reinstall/update command', () => {
  // (a) The command is produced in EVERY state — including connected/healthy
  // (mismatch=false) — so the panel can render it unconditionally and keep it
  // copyable at all times. Healthy framing is unobtrusive (not prominent).
  it('renders the extension-scoped command when healthy, unobtrusively', () => {
    const cmd = buildUpdateCommand('ehchmchlmggdigicfjfmlgcbhdcdcmll', false);
    expect(cmd.command).toBe('npx agenthub-setup@latest --update --extension-id ehchmchlmggdigicfjfmlgcbhdcdcmll');
    expect(cmd.prominent).toBe(false);
    expect(cmd.label.length).toBeGreaterThan(0);
  });

  it('falls back to the no-extension-id command when the id is unknown', () => {
    expect(buildUpdateCommand('', false).command).toBe('npx agenthub-setup@latest --update');
    expect(buildUpdateCommand(null, false).command).toBe('npx agenthub-setup@latest --update');
  });

  it('is loud (prominent) when there is a skew to fix', () => {
    const cmd = buildUpdateCommand('abc123', true);
    expect(cmd.prominent).toBe(true);
    expect(cmd.command).toContain('--extension-id abc123');
  });
});

describe('detectVersionSkew — three-way browser/bridge/helper comparison', () => {
  // (b) The exact outage scenario: extension v0.5.16, autostarted bridge stuck on
  // a stale v0.5.14, helper on v0.5.10 → mismatch, with the three versions listed.
  it('ext 0.5.16 / bridge 0.5.14 / helper 0.5.10 → mismatch, lists all three', () => {
    const skew = detectVersionSkew({ extension: '0.5.16', bridge: '0.5.14', helper: '0.5.10' });
    expect(skew.mismatch).toBe(true);
    expect(skew.browser).toBe('0.5.16');
    expect(skew.bridge).toBe('0.5.14');
    expect(skew.helper).toBe('0.5.10');
  });

  it('detects a two-way skew even when the third value is unknown (the real outage shape)', () => {
    // helper version often hasn't loaded yet, but ext != bridge is the skew.
    const skew = detectVersionSkew({ extension: '0.5.16', bridge: '0.5.14', helper: undefined });
    expect(skew.mismatch).toBe(true);
    expect(skew.helper).toBe('unknown');
  });

  // (c) All three matching → no callout.
  it('all three matching → no mismatch', () => {
    const skew = detectVersionSkew({ extension: '0.5.16', bridge: '0.5.16', helper: '0.5.16' });
    expect(skew.mismatch).toBe(false);
  });

  it('ignores a leading v and surrounding whitespace when comparing', () => {
    expect(detectVersionSkew({ extension: 'v0.5.16', bridge: '0.5.16 ', helper: ' v0.5.16' }).mismatch).toBe(false);
  });

  // (d) Genuinely-unknown values must NOT false-positive a skew.
  it('a single known version alongside unknowns → no mismatch (no false positive)', () => {
    expect(detectVersionSkew({ extension: '0.5.16', bridge: undefined, helper: undefined }).mismatch).toBe(false);
    expect(detectVersionSkew({ extension: '0.5.16', bridge: '', helper: null }).mismatch).toBe(false);
    expect(detectVersionSkew({ extension: '0.5.16', bridge: 'unknown', helper: 'N/A' }).mismatch).toBe(false);
  });

  it('all unknown → no mismatch, all reported as unknown', () => {
    const skew = detectVersionSkew({ extension: '', bridge: undefined, helper: 'unknown' });
    expect(skew.mismatch).toBe(false);
    expect(skew).toMatchObject({ browser: 'unknown', bridge: 'unknown', helper: 'unknown' });
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
        supersededRecentCount: 0,
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

  it('maps liveness + supersededCount (cumulative) + supersededRecentCount (rate) for our browserId', () => {
    const facts = extractApiStateFacts(
      mkPayload({ browsersExtra: { supersededCount: 5, supersededRecentCount: 2, liveness: 'stale' } }),
      'chrome:me',
      now,
    );
    expect(facts?.supersededCount).toBe(5);
    expect(facts?.supersededRecentCount).toBe(2);
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
