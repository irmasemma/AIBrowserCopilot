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
  it(`supersededRecentCount ≥ ${FLAPPING_SUPERSEDE_THRESHOLD} → flapping, re-run setup primary + restart offered`, () => {
    const v = deriveVerdict(args({ api: { ...liveFacts, supersededRecentCount: FLAPPING_SUPERSEDE_THRESHOLD } }));
    expect(v.kind).toBe('flapping');
    expect(v.title).toBe('Connection keeps dropping');
    // Primary action is now "copy setup command" (re-run npx) — the reliable
    // fix for the origin-not-in-allowlist flapping loop; restart bridge stays
    // as a secondary fallback so the recovery paths aren't lost.
    expect(v.actions[0]?.id).toBe('copy_install_command');
    expect(v.actions.map((a) => a.id)).toContain('restart_service');
    expect(v.subtitle).toMatch(/setup/i);
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

describe('deriveVerdict — down bridge + stale reconnects is NOT flapping (correctness fix)', () => {
  // Regression for the 2026-06-29 contradictory verdict: header said "Connection
  // keeps dropping" (flapping) while the diagnostics step showed "Lock file
  // present: ✕" (bridge not running). These cannot both be true. Root cause:
  // reconnectsThisSession≥3 from a previous storm fired the flapping fallback
  // (precedence 2) even when /api/state was absent BECAUSE the bridge was down,
  // masking the no_lock_file branch (precedence 3). Fix: isDefinitelyDown guard.

  it('no_lock_file + stale reconnectsThisSession → broken ("Bridge isn\'t running"), NOT flapping', () => {
    const v = deriveVerdict(args({
      ctx: { state: 'reconnecting', diagnosticReason: 'no_lock_file', reconnectsThisSession: 5 },
      api: null,
    }));
    expect(v.kind).toBe('broken');
    expect(v.kind).not.toBe('flapping');
    expect(v.title).toBe("Bridge isn't running");
  });

  it('bridge_not_started + high reconnectsThisSession → broken, NOT flapping', () => {
    const v = deriveVerdict(args({
      ctx: { state: 'reconnecting', diagnosticReason: 'bridge_not_started', reconnectsThisSession: 10 },
      api: null,
    }));
    expect(v.kind).toBe('broken');
    expect(v.kind).not.toBe('flapping');
  });

  it('reconnectsThisSession still fires flapping when bridge is NOT definitively down (null reason, no api)', () => {
    // was_connected or null reason: bridge was running, something is wrong.
    // The stale counter IS a valid flapping signal here.
    const v = deriveVerdict(args({
      ctx: { state: 'reconnecting', diagnosticReason: null, reconnectsThisSession: 5 },
      api: null,
    }));
    expect(v.kind).toBe('flapping');
  });

  it('broken (no_lock_file) + version mismatch → broken outranks version_mismatch verdict', () => {
    // Ensures the panel's version-mismatch callout is correctly demoted when
    // a more fundamental failure owns the verdict (step 3 before step 4).
    const v = deriveVerdict(args({
      ctx: { state: 'reconnecting', diagnosticReason: 'no_lock_file', versionStatus: 'outdated', reconnectsThisSession: 3 },
      api: null,
    }));
    expect(v.kind).toBe('broken');
    expect(v.kind).not.toBe('version_mismatch');
    expect(v.kind).not.toBe('flapping');
  });

  it('version mismatch only (bridge running, no broken reason) → version_mismatch IS the primary verdict', () => {
    // Confirms the version-mismatch callout remains full/primary when it is
    // the sole known problem (no bridge-down reason, bridge is live).
    const v = deriveVerdict(args({
      ctx: { state: 'connected', versionStatus: 'outdated', reconnectsThisSession: 0 },
      api: liveFacts,
    }));
    expect(v.kind).toBe('version_mismatch');
  });

  it('flapping verdict includes restart_service action; working/untested do not (panel de-dup anchor)', () => {
    const flapping = deriveVerdict(args({ api: { ...liveFacts, supersededRecentCount: FLAPPING_SUPERSEDE_THRESHOLD } }));
    expect(flapping.kind).toBe('flapping');
    expect(flapping.actions.map((a) => a.id)).toContain('restart_service');

    const working = deriveVerdict(args({ api: { ...liveFacts, hadRecentSuccess: true } }));
    expect(working.kind).toBe('working');
    expect(working.actions.map((a) => a.id)).not.toContain('restart_service');
  });

  it('broken/no_lock_file includes start_service, not restart_service (panel hides its own Restart)', () => {
    const v = deriveVerdict(args({ ctx: { state: 'reconnecting', diagnosticReason: 'no_lock_file' }, api: null }));
    expect(v.kind).toBe('broken');
    expect(v.actions.map((a) => a.id)).toContain('start_service');
    expect(v.actions.map((a) => a.id)).not.toContain('restart_service');
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
