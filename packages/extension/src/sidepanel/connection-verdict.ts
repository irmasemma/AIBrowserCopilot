import type { ConnectionContext } from '../shared/types.js';

/**
 * THE single source of truth for "what is the connection actually doing right now"
 * across every user-facing surface (header title, status badge, diagnostics panel).
 *
 * Why this module exists
 * ======================
 * The side panel header (`deriveHeader`) and the diagnostics panel (`buildSteps`)
 * used to derive status INDEPENDENTLY from `connectionContext`, and the dashboard
 * derived its own from `/api/state`. They disagreed in exactly the failure modes
 * that matter — the dashboard would read "stale" while the side panel sat green on
 * "Connected". One derivation, consumed everywhere, is the fix (design §4 / §7.2 /
 * §6.6: "unify the verdict across surfaces").
 *
 * The lie this kills
 * ==================
 * "Working / Connected — tools working" used to bind to `lastVerifiedAt`, which is
 * bumped by `onPong`/`onServerInfo`. A pong is NOT a tool round-trip — it rides the
 * very socket being superseded every ~1.3s during the relay storm, so the heartbeat
 * stays "on time" through a TOTAL outage. Here, "Working" requires a REAL tool-path
 * fact:
 *   - a recent real request SUCCESS for this browserId in `/api/state`
 *     `recentActivity`, OR
 *   - an on-demand synthetic `list_tabs` succeeded this session, OR
 *   - bridge liveness === 'live' for this browserId AND no recent failed/superseded
 *     requests AND a flat supersede count.
 * Otherwise a freshly-`connected` session is "Connected — not yet tested", never a
 * confident green (law: no silent staleness).
 */

/** A normalized view of THIS browser's row in `/api/state`, plus the recent-request
 *  facts the verdict needs. Caller (`useApiState`) extracts this from the raw
 *  `/api/state` payload, keyed to OUR browserId. Null when `/api/state` is
 *  unreachable or our browserId isn't present in it. */
export interface ApiStateFacts {
  /** Bridge-derived liveness for OUR browserId. */
  liveness: 'live' | 'stale' | 'unknown';
  /** Seconds since the bridge last heard an inbound frame from us. */
  lastSeenAgeSec: number | null;
  /** Cross-life relay supersede/replace count for OUR browserId — CUMULATIVE
   *  lifetime scar (resets only on a clean disconnect). Display/diagnostics
   *  only; do NOT drive the verdict from this (it stays high after a storm
   *  converges). The storm signal a single SW's `reconnectsThisSession` can't
   *  see. */
  supersededCount: number;
  /** Supersede events for OUR browserId within the bridge's rolling ~60s window
   *  — the RATE the Flapping verdict binds to (design §7.2.2). Decays to 0 once
   *  supersedes stop, so the verdict self-heals after convergence. */
  supersededRecentCount: number;
  /** Close code of the most recent relay close for OUR browserId (4002 = superseded). */
  lastRelayCloseCode: number | null;
  /** Idempotent-tie (same-life reconnect) recurrence for OUR browserId within the
   *  bridge's rolling ~60s window — a SEPARATE signal from `supersededRecentCount`
   *  (docs/rca-2026-07-06-same-life-reconnect-storm.md §4 Phase 3). A same-life
   *  reconnect storm looks "live" to every OTHER signal: liveness stays 'live'
   *  (inbound frames keep arriving) and supersededRecentCount stays 0 (idempotent
   *  ties are deliberately excluded — they aren't a different-identity replace).
   *  Without this field the storm is invisible and the verdict would read a false
   *  "Working" straight through it — the exact incident this field exists to catch. */
  idempotentTieRecentCount: number;
  /** Did a real request for OUR browserId succeed within the recent window? */
  hadRecentSuccess: boolean;
  /** Did a real request for OUR browserId fail/timeout within the recent window? */
  hadRecentFailure: boolean;
  /** Did a recent request fail specifically with the relay-storm signature? */
  hadRecentReplacedMidRequest: boolean;
}

export type VerdictKind =
  | 'working' // proven by a real tool-path fact
  | 'untested' // connected, but no tool call has proven it yet this session
  | 'flapping' // the relay keeps getting replaced before a command can finish
  | 'reconnect_storm' // same-life reconnect loop — invisible to Flapping by design
  | 'recovering' // 4002-terminal'd, waiting for the winner to die / SW to cycle
  | 'stale' // a previously-good connection went quiet
  | 'degraded' // heartbeats missing
  | 'connecting'
  | 'reconnecting'
  | 'version_mismatch'
  | 'broken' // a named, actionable hard failure (no bridge, protocol dead, etc.)
  | 'disconnected';

export type VerdictSeverity = 'ok' | 'warn' | 'error';

/** The `DisplayState` the status badge renders — superset of `ConnectionState`. */
export type BadgeState =
  | 'working'
  | 'untested'
  | 'flapping'
  | 'recovering'
  | 'stale'
  | 'degraded'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected';

export interface VerdictAction {
  id:
    | 'run_quick_check'
    | 'restart_service'
    | 'reconnect_now'
    | 'reload_extension'
    | 'start_service'
    | 'copy_install_command';
  label: string;
  variant: 'primary' | 'secondary';
}

export interface Verdict {
  kind: VerdictKind;
  /** Headline shown in the header title row. */
  title: string;
  /** One-line plain-English explanation. */
  subtitle: string | null;
  severity: VerdictSeverity;
  /** Which badge state the dot/icon renders. */
  badge: BadgeState;
  /** Ordered recovery actions (first = primary). */
  actions: VerdictAction[];
  /** Expand the diagnostics panel automatically? */
  autoOpenDiagnostics: boolean;
}

export interface DeriveVerdictArgs {
  ctx: Pick<
    ConnectionContext,
    'state' | 'diagnosticReason' | 'failureCount' | 'lastConnectedAt' | 'reconnectsThisSession' | 'lastVerifiedAt' | 'versionStatus'
  >;
  /** Facts pulled from `/api/state` for OUR browserId. Null when unavailable. */
  api: ApiStateFacts | null;
  /** Did an on-demand "Run a quick check" (synthetic list_tabs) succeed this
   *  session? Once true, "Working" is provable without waiting for a real MCP call. */
  quickCheckPassed: boolean;
  /** ms the connection has been in reconnecting/connecting. */
  reconnectingSinceMs: number | null;
  /** ms threshold above which staleness applies (= STALE_THRESHOLD_MS). */
  staleThresholdMs: number;
}

/** Flapping threshold: this many supersede/replace events for our browserId in the
 *  bridge's rolling window means the relay is being torn down faster than a command
 *  can complete. Bound to the BRIDGE replace-rate (cross-life), not a single SW's
 *  reconnectsThisSession (design §7.2.2). */
export const FLAPPING_SUPERSEDE_THRESHOLD = 3;
/** Secondary corroborator only (design §7.2.2): a single SW seeing this many
 *  reconnects also counts as flapping even if /api/state is briefly unavailable. */
export const FLAPPING_RECONNECTS_THRESHOLD = 3;
/** Reconnect-storm threshold (docs/rca-2026-07-06-same-life-reconnect-storm.md
 *  §4 Phase 3): this many idempotent (same-life) ties for our browserId within
 *  the bridge's rolling ~60s window means the SW is stuck reopening its own
 *  socket every few seconds. Lower bar than Flapping's supersede threshold is
 *  NOT appropriate here — idempotent ties are individually benign (Phase 2
 *  preserves in-flight tool calls through them) — so this is set a little
 *  looser than FLAPPING_SUPERSEDE_THRESHOLD to avoid flagging a couple of
 *  ordinary transport blips as a "storm". */
export const RECONNECT_STORM_TIE_THRESHOLD = 5;

const INSTALL_COMMAND_ACTION: VerdictAction = {
  id: 'copy_install_command',
  label: 'Copy update command',
  variant: 'primary',
};

/**
 * Three-way version-skew detection across the extension (browser), the bridge,
 * and the native-messaging helper.
 *
 * Why this lives here (and not only in the panel): the version verdict is a
 * first-class user-visible state (design §4 / §7.2 / ui-ux law: "version skew is
 * a first-class state"), and keeping the comparison rule in the shared verdict
 * module means every surface that can see all three versions reasons about them
 * the SAME way. The header's `versionStatus` only knows bridge-vs-minimum; the
 * diagnostics panel is the only surface that also holds the helper version (it
 * fetches the helper snapshot), so it's the surface that computes the full
 * three-way skew — but it does so through this one shared rule.
 *
 * The skew that caused the 2026-06-28 outage: a loaded extension on v0.5.16 with
 * an autostarted bridge binary stuck on a stale v0.5.14 — "Connected" while every
 * tool call failed. The UI must call that out loudly.
 */

/** Normalize a raw version to a clean display value, or `null` when the value is
 *  genuinely unknown. Unknown values MUST be ignored by the mismatch rule —
 *  otherwise a slow helper poll that hasn't returned yet (helperVersion absent)
 *  would false-positive a skew. */
function normalizeVersion(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim().replace(/^v/i, '');
  if (t === '' || /^(unknown|n\/?a)$/i.test(t)) return null;
  return t;
}

export interface VersionSkew {
  /** True ONLY when ≥2 DISTINCT known versions exist across browser/bridge/helper.
   *  Genuinely-unknown values are ignored, so a not-yet-loaded value never trips
   *  a false positive (design §4: "ignore genuinely-unknown values"). */
  mismatch: boolean;
  /** Display string for the extension version ('unknown' when unavailable). */
  browser: string;
  /** Display string for the bridge version ('unknown' when unavailable). */
  bridge: string;
  /** Display string for the helper version ('unknown' when unavailable). */
  helper: string;
}

/**
 * Compare the three component versions. A mismatch requires at least two DISTINCT
 * *known* versions — any number of unknowns alongside a single known version is
 * NOT a mismatch (no false positives while values are still loading).
 */
export function detectVersionSkew(input: {
  extension?: string | null;
  bridge?: string | null;
  helper?: string | null;
}): VersionSkew {
  const browser = normalizeVersion(input.extension);
  const bridge = normalizeVersion(input.bridge);
  const helper = normalizeVersion(input.helper);
  const distinctKnown = new Set([browser, bridge, helper].filter((v): v is string => v !== null));
  return {
    mismatch: distinctKnown.size > 1,
    browser: browser ?? 'unknown',
    bridge: bridge ?? 'unknown',
    helper: helper ?? 'unknown',
  };
}

export interface UpdateCommand {
  /** The exact command to run — ALWAYS present, never empty. Carries the
   *  extension ID when known so the installer re-registers the right origin. */
  command: string;
  /** Context label shown above the command. */
  label: string;
  /** Loud when there's a real skew to fix; unobtrusive when healthy. */
  prominent: boolean;
}

/**
 * Build the always-visible reinstall/update command for the diagnostics panel.
 * The command is produced in EVERY connection state (the panel renders it
 * unconditionally) so the user can always copy "re-run the installer" — the fix
 * for the silent version-skew outage. `mismatch` only changes the framing
 * (loud vs unobtrusive), never whether the command exists.
 */
export function buildUpdateCommand(extId: string | null | undefined, mismatch: boolean): UpdateCommand {
  const command = extId
    ? `npx agenthub-setup@latest --update --extension-id ${extId}`
    : 'npx agenthub-setup@latest --update';
  return {
    command,
    label: mismatch ? 'Update every AgentHub part to the same version:' : 'Reinstall or update AgentHub:',
    prominent: mismatch,
  };
}

/**
 * THE decision rule. Precedence is deliberate (most-dangerous-lie first):
 *
 *   1. Recovering (awaiting_sw_recovery) — must NEVER read "Connected".
 *   2. Flapping — bound to the bridge replace-rate; the storm is invisible to a
 *      single SW, so /api/state.supersededCount is primary.
 *   2b. Reconnecting rapidly — same-life idempotent-tie storm rate, a SEPARATE
 *      signal from Flapping's supersede rate (the two storm shapes are mutually
 *      exclusive by identity, but both must be caught before a false "Working").
 *   3. Hard named failures (no bridge / protocol dead / setup) — actionable.
 *   4. Version mismatch.
 *   5. Stale — a previously-good link gone quiet.
 *   6. Degraded — heartbeats missing.
 *   7. connected → Working ONLY with a real tool-path fact; else Untested.
 *   8. connecting / reconnecting / disconnected.
 */
export function deriveVerdict(args: DeriveVerdictArgs): Verdict {
  const { ctx, api, quickCheckPassed, reconnectingSinceMs, staleThresholdMs } = args;
  const reason = ctx.diagnosticReason;
  const reconnectingTooLong = (reconnectingSinceMs ?? 0) > 30_000;

  // ── 1. Recovering — the silent dead-window (§7.2.1 / §8.2) ──────────────────
  // 4002-terminal'd: no live relay, but NOT in scheduleBackoff. Without this the
  // panel sits stale-green (green-but-zero-tabs class). MUST not read "Connected".
  if (reason === 'awaiting_sw_recovery') {
    return {
      kind: 'recovering',
      title: 'Reconnecting to your browser',
      subtitle: 'This usually fixes itself in a few seconds. You can nudge it if it doesn’t.',
      severity: 'warn',
      badge: 'recovering',
      actions: [{ id: 'reconnect_now', label: 'Reconnect now', variant: 'primary' }],
      autoOpenDiagnostics: false,
    };
  }

  // ── 2. Flapping — bound to the BRIDGE supersede RATE, not a lifetime count ──
  // The storm is split across two SW lives and largely invisible to any single
  // SW's reconnectsThisSession (§7.2.2). /api/state.supersededRecentCount counts
  // supersedes across both lives on one browserId WITHIN A ROLLING WINDOW, so it
  // is the PRIMARY signal AND it decays to 0 once the storm converges — the
  // verdict self-heals instead of lying "keeps dropping" forever (the cumulative
  // supersededCount would stay ≥ threshold for the life of the bridge). A request
  // failing with the storm signature is corroborating; reconnectsThisSession is a
  // weak secondary fallback for when /api/state is momentarily unreachable.
  const flappingFromBridge =
    api !== null &&
    (api.supersededRecentCount >= FLAPPING_SUPERSEDE_THRESHOLD || api.hadRecentReplacedMidRequest);
  // Guard: a "definitely down" diagnostic reason means /api/state is unreachable
  // BECAUSE the bridge is not running — not because of a transient drop. A stale
  // reconnectsThisSession counter from a previous storm MUST NOT make a down
  // bridge look like flapping. This is the exact false verdict the 2026-06-29
  // scenario produced: no_lock_file + reconnects≥3 → "Connection keeps dropping"
  // while the diagnostic step below showed "Lock file present: ✕".
  const isDefinitelyDown = reason === 'no_lock_file' || reason === 'bridge_not_started';
  const flappingFromClient = !isDefinitelyDown && ctx.reconnectsThisSession >= FLAPPING_RECONNECTS_THRESHOLD;
  if (flappingFromBridge || (api === null && flappingFromClient)) {
    return {
      kind: 'flapping',
      title: 'Connection keeps dropping',
      subtitle:
        'AgentHub keeps reconnecting to your browser, but each link is replaced before a command can finish, so tools aren’t working right now. Re-running AgentHub setup usually fixes this — copy the setup command and run it in a terminal. Restarting the bridge can also help.',
      severity: 'error',
      badge: 'flapping',
      // Re-running setup (npx) is the primary recovery: it re-registers this
      // extension with the bridge (the common cause is the extension's origin
      // missing from the bridge allowlist, which a bare "restart" does NOT fix).
      // Restart/reload stay as secondary fallbacks.
      actions: [
        { id: 'copy_install_command', label: 'Copy setup command', variant: 'primary' },
        { id: 'restart_service', label: 'Restart bridge', variant: 'secondary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  // ── 2b. Reconnecting rapidly — same-life idempotent-tie storm ───────────────
  // Checked BEFORE "connected → Working" (step 7) is even reached: a same-life
  // reconnect storm (docs/rca-2026-07-06-same-life-reconnect-storm.md) makes
  // liveness stay 'live' (inbound frames keep arriving every few seconds) and
  // supersededRecentCount stay 0 (idempotent ties are deliberately excluded
  // from that signal), so without this check the panel would read a false
  // "Working" straight through an active storm — the exact invisible-failure
  // shape the incident proved. Own signal, own precedence tier: it must not be
  // masked by (or double-count into) Flapping.
  const reconnectingRapidly =
    api !== null && api.idempotentTieRecentCount >= RECONNECT_STORM_TIE_THRESHOLD;
  if (reconnectingRapidly) {
    return {
      kind: 'reconnect_storm',
      title: 'Reconnecting rapidly',
      subtitle:
        'Your browser keeps reopening the same connection every few seconds. Tool calls may be failing while this continues — reloading the extension usually stops it.',
      severity: 'warn',
      badge: 'degraded',
      actions: [
        { id: 'reload_extension', label: 'Reload extension', variant: 'primary' },
        { id: 'restart_service', label: 'Restart bridge', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  // ── 3. Hard named failures — surface the actionable step ────────────────────
  if (reason === 'no_lock_file' || reason === 'bridge_not_started') {
    return {
      kind: 'broken',
      title: "Bridge isn't running",
      subtitle:
        reason === 'no_lock_file'
          ? 'No AgentHub service was found. Start it to enable browser tools.'
          : 'A bridge is registered but not currently running.',
      severity: 'error',
      badge: 'disconnected',
      actions: [
        { id: 'start_service', label: 'Start AgentHub service', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  if (reason === 'helper_unavailable') {
    return {
      kind: 'broken',
      title: 'Setup incomplete',
      subtitle: 'The native messaging helper isn’t registered. Re-run the installer.',
      severity: 'error',
      badge: 'disconnected',
      actions: [
        { id: 'copy_install_command', label: 'Copy install command', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  if (reason === 'server_not_responding' || reason === 'protocol_timeout') {
    return {
      kind: 'broken',
      title: 'Bridge running but unresponsive',
      subtitle:
        reason === 'protocol_timeout'
          ? 'The service accepted the connection but never spoke the protocol. Restart it.'
          : 'The service isn’t answering. Restart to recover.',
      severity: 'error',
      badge: 'disconnected',
      actions: [
        { id: 'restart_service', label: 'Restart service', variant: 'primary' },
        { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: true,
    };
  }

  // ── 4. Version mismatch ─────────────────────────────────────────────────────
  if (ctx.versionStatus === 'outdated') {
    return {
      kind: 'version_mismatch',
      title: 'Versions don’t match',
      subtitle: 'Your AgentHub pieces are on different versions. They work best when they all match — updating takes about a minute.',
      severity: 'warn',
      badge: 'degraded',
      actions: [INSTALL_COMMAND_ACTION, { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' }],
      autoOpenDiagnostics: false,
    };
  }

  const isConnectedish = ctx.state === 'connected' || ctx.state === 'degraded';

  // ── 5. Stale — previously-good link gone quiet ──────────────────────────────
  // Prefer bridge truth: liveness='stale' is the authoritative cross-surface
  // signal (it's what the dashboard shows). Fall back to the client's
  // lastVerifiedAt age only when /api/state is unavailable.
  const bridgeSaysStale = api !== null && api.liveness === 'stale';
  const clientSaysStale =
    api === null &&
    isConnectedish &&
    ctx.lastVerifiedAt > 0 &&
    Date.now() - ctx.lastVerifiedAt > staleThresholdMs;
  if (isConnectedish && (bridgeSaysStale || clientSaysStale)) {
    return {
      kind: 'stale',
      title: 'Connection went quiet',
      subtitle: 'AgentHub hasn’t heard from your browser recently. Reconnect to be sure tools still work.',
      severity: 'warn',
      badge: 'stale',
      actions: [{ id: 'reconnect_now', label: 'Reconnect', variant: 'primary' }],
      autoOpenDiagnostics: false,
    };
  }

  // ── 6. Degraded — heartbeats missing ────────────────────────────────────────
  if (ctx.state === 'degraded') {
    return {
      kind: 'degraded',
      title: 'Connection unstable',
      subtitle: 'Heartbeats are missing. Try restarting the service.',
      severity: 'warn',
      badge: 'degraded',
      actions: [
        { id: 'restart_service', label: 'Restart service', variant: 'primary' },
        { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
      ],
      autoOpenDiagnostics: false,
    };
  }

  // ── 7. connected → Working (proven) vs Untested (default) ───────────────────
  if (ctx.state === 'connected') {
    // A real recent request failed/superseded for us → never claim Working.
    const recentlyFailed = api !== null && api.hadRecentFailure;

    // Working requires a REAL tool-path fact, never a pong:
    //   (a) a real request succeeded recently for our browserId, OR
    //   (b) an on-demand quick check (synthetic list_tabs) passed this session, OR
    //   (c) bridge liveness='live' AND no recent failure AND flat supersede count.
    const provenBySuccess = api !== null && api.hadRecentSuccess && !recentlyFailed;
    const provenByLiveness =
      api !== null &&
      api.liveness === 'live' &&
      !recentlyFailed &&
      api.supersededRecentCount < FLAPPING_SUPERSEDE_THRESHOLD;
    const working = provenBySuccess || provenByLiveness || (quickCheckPassed && !recentlyFailed);

    if (working) {
      return {
        kind: 'working',
        title: 'Connected — tools working',
        subtitle: null,
        severity: 'ok',
        badge: 'working',
        actions: [],
        autoOpenDiagnostics: false,
      };
    }

    // Connected but NOT yet proven by a tool-path fact. This is the honest
    // default — green dot would be a lie (law: no silent staleness).
    return {
      kind: 'untested',
      title: 'Connected — not yet tested',
      subtitle: 'The bridge is up. Run a quick check to confirm browser tools actually work.',
      severity: 'warn',
      badge: 'untested',
      actions: [{ id: 'run_quick_check', label: 'Run a quick check', variant: 'primary' }],
      autoOpenDiagnostics: false,
    };
  }

  // ── 8. was_connected / reconnecting / connecting / disconnected ─────────────
  if (reason === 'was_connected') {
    return {
      kind: 'reconnecting',
      title: 'Lost connection',
      subtitle: 'Reopen your AI tool to reconnect.',
      severity: 'warn',
      badge: 'reconnecting',
      actions: [
        { id: 'reconnect_now', label: 'Reconnect now', variant: 'primary' },
        { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
      ],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  if (ctx.state === 'reconnecting') {
    return {
      kind: 'reconnecting',
      title: reconnectingTooLong ? 'Bridge looks broken' : `Reconnecting (attempt ${ctx.failureCount})…`,
      subtitle: reconnectingTooLong
        ? 'Reconnect attempts have been failing — open diagnostics for details.'
        : 'Trying to re-establish the connection.',
      severity: reconnectingTooLong ? 'error' : 'warn',
      badge: 'reconnecting',
      actions: reconnectingTooLong
        ? [
            { id: 'restart_service', label: 'Restart service', variant: 'primary' },
            { id: 'reconnect_now', label: 'Reconnect', variant: 'secondary' },
            { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
          ]
        : [],
      autoOpenDiagnostics: reconnectingTooLong,
    };
  }

  if (ctx.state === 'connecting') {
    return {
      kind: 'connecting',
      title: 'Looking for bridge…',
      subtitle: 'Finding the running AgentHub service.',
      severity: 'warn',
      badge: 'connecting',
      actions: [],
      autoOpenDiagnostics: false,
    };
  }

  return {
    kind: 'disconnected',
    title: 'Not connected',
    subtitle: 'Start the AgentHub service to enable browser tools.',
    severity: 'error',
    badge: 'disconnected',
    actions: [
      { id: 'start_service', label: 'Start AgentHub service', variant: 'primary' },
      { id: 'reload_extension', label: 'Reload extension', variant: 'secondary' },
    ],
    autoOpenDiagnostics: false,
  };
}

/**
 * Extract the facts the verdict needs from a raw `/api/state` payload, keyed to
 * OUR browserId. Returns null when our browserId is not present (we should not
 * borrow another browser's liveness). `recentWindowMs` bounds "recent" so an old
 * success can't keep masquerading as proof of a currently-working link.
 */
export function extractApiStateFacts(
  payload: ApiStatePayload,
  myBrowserId: string,
  nowMs: number,
  recentWindowMs = 60_000,
): ApiStateFacts | null {
  const mine = payload.browsers?.find((b) => b.browserId === myBrowserId);
  if (!mine) return null;

  const requests = payload.recentActivity?.requests ?? [];
  let hadRecentSuccess = false;
  let hadRecentFailure = false;
  let hadRecentReplacedMidRequest = false;
  for (const r of requests) {
    if (r.browserId !== myBrowserId) continue;
    const ts = r.finishedAt ? Date.parse(r.finishedAt) : Date.parse(r.startedAt);
    if (Number.isFinite(ts) && nowMs - ts > recentWindowMs) continue;
    if (r.status === 'success') hadRecentSuccess = true;
    if (r.status === 'error' || r.status === 'timeout') {
      hadRecentFailure = true;
      if ((r.errorMessage ?? '').includes('browser_socket_replaced_mid_request')) {
        hadRecentReplacedMidRequest = true;
      }
    }
  }

  return {
    liveness: mine.liveness ?? 'unknown',
    lastSeenAgeSec: mine.lastSeenAgeSec ?? null,
    supersededCount: mine.supersededCount ?? 0,
    supersededRecentCount: mine.supersededRecentCount ?? 0,
    lastRelayCloseCode: mine.lastRelayCloseCode ?? null,
    idempotentTieRecentCount: mine.idempotentTieRecentCount ?? 0,
    hadRecentSuccess,
    hadRecentFailure,
    hadRecentReplacedMidRequest,
  };
}

/** Minimal shape of `/api/state` this module reads. Mirrors `StateSource` in
 *  `diag-server.ts` (the fields the truthful UI consumes). */
export interface ApiStatePayload {
  browsers?: Array<{
    browserId: string;
    liveness?: 'live' | 'stale' | 'unknown';
    lastSeenAgeSec?: number | null;
    supersededCount?: number;
    supersededRecentCount?: number;
    lastRelayCloseCode?: number | null;
    idempotentTieRecentCount?: number;
  }>;
  recentActivity?: {
    requests?: Array<{
      browserId: string;
      status: 'pending' | 'success' | 'error' | 'timeout';
      startedAt: string;
      finishedAt: string | null;
      errorMessage?: string;
    }>;
  };
}
