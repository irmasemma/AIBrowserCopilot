import type { ConnectionContext, ConnectionState, ServerInfo, ToolScanResult, DiagnosticReason } from '../shared/types';
import { transition, createInitialContext } from './connection-machine';
import type { ConnectionEvent } from './connection-machine';
import { createBackoffTimer } from './backoff-manager';
import { createHeartbeatMonitor, DEFAULT_HEARTBEAT_CONFIG } from './heartbeat-monitor';
import type { HeartbeatMonitor } from './heartbeat-monitor';
import { createRelay } from './relay-client';
import type { Relay } from './relay-client';
import type { DiscoveryResult } from './service-discovery';
import { checkBridgeVersion } from '../shared/version-check';
import { logRecord, flushPending } from '../shared/logger';
import { getBrowserInstanceId } from '../shared/browser-instance-id';

const DEFAULT_URL = 'ws://127.0.0.1:7483';
const SERVER_INFO_TIMEOUT_MS = 10_000;

// ── Relay identity = (genTimestamp, lifeUuid) — IN-MEMORY, never persisted ──
// Captured ONCE per service-worker life at module load. The bridge resolves a
// browserId collision by a STRICT lexicographic total order on (gen, lifeUuid):
// strictly-higher wins + supersedes; exact tie is idempotent (same SW life's
// own transport-blip reconnect); strictly-lower is rejected with close 4002.
//
// Why in-memory, not chrome.storage:
//   - `Date.now()` at SW load is monotone-enough across overlapping lives and
//     needs NO read-modify-write, so two near-simultaneous lives can't race to
//     the same value the way a persisted counter would.
//   - Nothing is persisted, so a storage wipe / extension update can't roll the
//     value back and invert the order into a permanent 4002 lockout.
//   - `lifeUuid` is a per-load random tiebreak that makes the order TOTAL even
//     in the (rare) case two lives capture the same millisecond.
// (See design §6.2/§6.3/§7.1.2 — the converged identity.)
let relayGenTimestamp = Date.now();
let relayLifeUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Mint a FRESH relay identity for this SW life. Called by the guarded alarm
 * re-challenge (reconcile) when a prior identity was 4002-terminal'd and bridge
 * truth confirms there is no live relay for this browserId — so the new
 * challenge outranks any stale incumbent. Never called on the happy path.
 */
function mintFreshRelayIdentity(): void {
  relayGenTimestamp = Date.now();
  relayLifeUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Mark this connection as the canonical extension relay and stamp it with this
 * SW life's identity (`role=relay&gen=<ts>&lifeUuid=<uuid>`). The bridge uses
 * this IDENTITY — not a liveness guess — to decide browserId collisions via a
 * total order on (gen, lifeUuid). Probes/health-checks must NOT carry this
 * marker. lifeUuid is sent raw (it is already URL-safe: a UUID or [0-9a-z.-]);
 * the bridge compares it byte-for-byte as the raw query string, so we must not
 * re-encode it here.
 */
function withRelayRole(url: string): string {
  let out = url;
  if (!/[?&]role=relay(&|$)/.test(out)) {
    out = out.includes('?') ? `${out}&role=relay` : `${out}?role=relay`;
  }
  if (!/[?&]gen=/.test(out)) out += `&gen=${relayGenTimestamp}`;
  if (!/[?&]lifeUuid=/.test(out)) out += `&lifeUuid=${relayLifeUuid}`;
  return out;
}

export type ToolRequestHandler = (id: string, tool: string, params: Record<string, unknown>) => void;
export type ToolScanHandler = (tools: ToolScanResult[]) => void;
export type DiscoverUrlFn = () => Promise<DiscoveryResult>;

export interface ConnectionManagerOptions {
  onToolRequest?: ToolRequestHandler;
  onToolScan?: ToolScanHandler;
  discoverUrl?: DiscoverUrlFn;
}

export interface ConnectionManager {
  connect(url?: string): Promise<void>;
  disconnect(): void;
  retry(): void;
  reconcile(): Promise<void>;
  isRelayAlive(): boolean;
  getContext(): ConnectionContext;
  getRelay(): Relay | null;
  onStateChange(listener: (ctx: ConnectionContext) => void): () => void;
}

function persistContext(ctx: ConnectionContext): void {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({
        connectionContext: ctx,
        connectionState: { state: ctx.state, lastConnected: ctx.lastConnectedAt, error: ctx.error },
      });
    }
  } catch {
    // Ignore — may not be in Chrome environment
  }
}

export function createConnectionManager(options: ConnectionManagerOptions = {}): ConnectionManager {
  let context: ConnectionContext = createInitialContext();
  let relay: Relay | null = null;
  // ── Relay callback generation token (RCA 2026-07-06 §4 item 2) ──────────
  // Bumped every time openRelay() creates a NEW relay instance. Every
  // callback wired to a given instance captures the generation value at
  // creation time and no-ops if it is no longer current when the callback
  // actually fires. This makes a stale callback structurally inert
  // regardless of which close path produced it (discard vs disconnect vs a
  // future bug reintroducing the same shape) — the callback bodies mutate
  // SHARED state (`relay`, `context`, `heartbeat`) by closure, so a late
  // callback from a superseded instance would otherwise stomp on the live
  // one's state (e.g. nulling `relay` out from under the newer, live
  // attempt). This is DISTINCT from the (gen,lifeUuid) relay IDENTITY above
  // — that one is per-SW-life and sent to the bridge; this one is per
  // openRelay() call and never leaves this module.
  let relayCallGeneration = 0;
  let heartbeat: HeartbeatMonitor | null = null;
  const backoffTimer = createBackoffTimer();
  let serverInfoTimer: ReturnType<typeof setTimeout> | null = null;
  // Periodic log-flush timer: ensures extension log entries reach the bridge
  // every ~10s while connected, not just on reconnect. Without this, a
  // long-running healthy session would never write its extension events to
  // extension.log — defeating the "grep all logs to debug" goal.
  let logFlushTimer: ReturnType<typeof setInterval> | null = null;
  const LOG_FLUSH_INTERVAL_MS = 10_000;
  let currentUrl: string = DEFAULT_URL;
  // §6.5 Web Lock optimization: resolver that releases the narrowly-held
  // 'agenthub-relay' lock once this open attempt settles (server_info / close /
  // timeout). Null when no lock is held. Held ONLY around open→server_info,
  // never for the session, and acquired with { ifAvailable: true } so a wedged
  // holder can never block — correctness is guaranteed by the (gen,lifeUuid)
  // total order regardless of the lock.
  let releaseRelayLock: (() => void) | null = null;

  const listeners = new Set<(ctx: ConnectionContext) => void>();

  function dispatch(event: ConnectionEvent): void {
    const prev = context;
    context = transition(context, event);
    if (context !== prev) {
      persistContext(context);
      for (const listener of listeners) {
        listener(context);
      }
    }
  }

  /**
   * Send pending log entries to the bridge. Wrapped here so onServerInfo
   * AND the periodic timer can both call the same path with the same
   * delivery semantics (return true only when WS is open and send
   * synchronously queues the frame).
   */
  function sendLogBatch(envelope: { type: 'log_batch'; entries: unknown[] }): boolean {
    if (!relay || !relay.isConnected()) return false;
    relay.send(envelope);
    return true;
  }

  function startLogFlushTimer(): void {
    if (logFlushTimer !== null) return;
    logFlushTimer = setInterval(() => {
      flushPending(sendLogBatch).catch(() => { /* logger never throws but be safe */ });
    }, LOG_FLUSH_INTERVAL_MS);
  }

  function stopLogFlushTimer(): void {
    if (logFlushTimer !== null) {
      clearInterval(logFlushTimer);
      logFlushTimer = null;
    }
  }

  /**
   * Tear down everything associated with the CURRENT relay attempt: heartbeat,
   * backoff timer, log-flush timer, the relay Web Lock, the server_info
   * timer, and the relay itself (via `discard()`, never `disconnect()` — see
   * relay-client.ts). Shared by `stopAll()` and `openRelay()`'s pre-replace
   * step so BOTH paths get the identical guarantee (RCA 2026-07-06 §4 item
   * 5): no serverInfoTimer leak on the direct openRelay() path, no stray
   * onclose from a socket this module has already forgotten about, and a
   * single re-entrancy-safe place that derives "close the old one" from
   * state (`relay !== null`) rather than a hand-rolled boolean flag.
   */
  function teardownRelay(): void {
    heartbeat?.stop();
    heartbeat = null;
    backoffTimer.cancel();
    stopLogFlushTimer();
    releaseLock();
    if (serverInfoTimer !== null) {
      clearTimeout(serverInfoTimer);
      serverInfoTimer = null;
    }
    // Also close any open relay. Previously, stopAll left the relay alive,
    // and callers (retry / reconcile / scheduleBackoff) relied on openRelay
    // to overwrite it — but overwriting only nulled the JS reference, the
    // underlying WS stayed connected to the bridge with no JS handler. The
    // bridge would then route tool_request frames to a socket the extension
    // had forgotten about, causing silent 10s timeouts.
    if (relay !== null) {
      try { relay.discard(); } catch { /* ignore */ }
      relay = null;
    }
  }

  function stopAll(): void {
    teardownRelay();
  }

  // Release the narrowly-held relay Web Lock, if any. Idempotent.
  function releaseLock(): void {
    if (releaseRelayLock !== null) {
      const r = releaseRelayLock;
      releaseRelayLock = null;
      try { r(); } catch { /* ignore */ }
    }
  }

  // Acquire the 'agenthub-relay' Web Lock around a single open attempt, holding
  // it until `releaseLock()` is called (on server_info / close / timeout). Uses
  // { ifAvailable: true }: if another in-profile SW life holds it, we DO NOT
  // wait — we proceed immediately and let the bridge's (gen,lifeUuid) total
  // order pick the single winner. Best-effort; never throws, never blocks.
  function acquireRelayLock(): void {
    releaseLock();
    try {
      const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
      if (!locks || typeof locks.request !== 'function') return;
      void locks.request('agenthub-relay', { ifAvailable: true }, (lock) => {
        // lock === null → unavailable; proceed without holding it (no-op hold).
        if (lock === null) return undefined;
        return new Promise<void>((resolve) => { releaseRelayLock = resolve; });
      }).catch(() => { /* lock API rejected — proceed anyway */ });
    } catch {
      // navigator.locks unavailable (older/test env) — correctness unaffected.
    }
  }

  function scheduleBackoff(): void {
    backoffTimer.schedule(context.failureCount, () => {
      dispatch({ type: 'BACKOFF_EXPIRED' });
      refreshUrl().then(() => openRelay());
    });
  }

  // Diagnostics that name a specific recoverable failure. Surface these as-is
  // (even after a prior successful connection) so the UI shows the actionable
  // button ("Start AgentHub service", "Restart service", "Copy install command")
  // instead of the generic "Lost connection — Reopen autostart to reconnect"
  // and so the SW's auto-recovery loop (background.ts:RECOVERABLE_REASONS)
  // can fire.
  const ACTIONABLE_REASONS: DiagnosticReason[] = [
    'no_lock_file',
    'bridge_not_started',
    'server_not_responding',
    'protocol_timeout',
    'helper_unavailable',
    // The relay-superseded dead-window. Must surface as-is (not collapse to the
    // generic 'was_connected') so the UI shows the "Reconnecting… / Reconnect
    // now" affordance instead of lying "Connected" during the window (§7.2.1).
    'awaiting_sw_recovery',
  ];

  function setDiagnostic(reason: DiagnosticReason): void {
    // After a successful connection, if the new reason isn't itself actionable,
    // surface 'was_connected' so the UI tells the user how to reconnect.
    // Actionable reasons pass through so recovery can drive the fix.
    const effectiveReason =
      context.serverInfo !== null && reason !== 'connecting' && !ACTIONABLE_REASONS.includes(reason)
        ? 'was_connected'
        : reason;
    if (context.diagnosticReason !== effectiveReason) {
      context = { ...context, diagnosticReason: effectiveReason };
      persistContext(context);
      for (const listener of listeners) {
        listener(context);
      }
    }
  }

  async function refreshUrl(): Promise<void> {
    if (!options.discoverUrl) return;
    try {
      const result = await options.discoverUrl();
      const urlChanged = result.url !== currentUrl;
      currentUrl = result.url;
      setDiagnostic(result.diagnostic);
      // §6.1: only a URL CHANGE (a genuinely different bridge appeared, e.g.
      // restart on a new port) resets failureCount for an immediate attempt.
      // We deliberately NO LONGER reset just because the lock file is reachable
      // (`diagnostic === 'connecting'`): during the relay storm each cycle is
      // briefly "reachable", and resetting here kept backoff pinned at the ~1s
      // floor (the amplifier). A stable connection resets failureCount via the
      // first HEARTBEAT_OK instead.
      if (urlChanged) {
        context = { ...context, failureCount: 0 };
      }
    } catch {
      // Keep current URL if discovery fails
    }
  }

  /**
   * §8.2 bridge-truth liveness probe. Asks the bridge's /api/state whether a
   * relay for THIS browserId is present-and-not-wedged (the healthy winner).
   * Returns:
   *   'live'    — a relay for my browserId is present and NOT stale → a healthy
   *               winner exists; the guarded retry must stay quiet. This covers
   *               BOTH `liveness==='live'` (heard recently) AND `'unknown'`
   *               (just connected, no inbound frame yet — server_ping is only
   *               every ~20s, so a fresh winner legitimately reads 'unknown' for
   *               a window; treating it as a winner avoids re-challenging it).
   *   'none'    — no relay for my browserId, OR it is `stale` (>45s silent — the
   *               winner is gone/wedged; the bridge sweep will reap it) → safe
   *               to re-challenge.
   *   'unknown' — could not determine (bridge unreachable / parse error). The
   *               caller treats this like 'none' for recovery (better to try to
   *               reconnect than hang), but it is logged distinctly.
   */
  async function probeBridgeRelayLiveness(): Promise<'live' | 'none' | 'unknown'> {
    try {
      const httpBase = currentUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/[?#].*$/, '');
      const myBrowserId = await getBrowserInstanceId();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3_000);
      let res: Response;
      try {
        res = await fetch(`${httpBase}/api/state`, { signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) return 'unknown';
      const data = await res.json() as { browsers?: Array<{ browserId: string; liveness?: string }> };
      const mine = data.browsers?.find((b) => b.browserId === myBrowserId);
      if (!mine) return 'none';
      // A present relay that is NOT explicitly 'stale' counts as a live winner.
      return mine.liveness === 'stale' ? 'none' : 'live';
    } catch {
      return 'unknown';
    }
  }

  function openRelay(): void {
    // Unified teardown (RCA 2026-07-06 §4 item 5): the SAME path stopAll()
    // uses, so this direct-replace step also gets discard() (not
    // disconnect()) plus the heartbeat/backoff-timer/log-flush-timer/lock/
    // serverInfoTimer cleanup — previously only stopAll() cleaned those up,
    // leaving a serverInfoTimer leak on this path.
    const wasReplacing = relay !== null;
    if (wasReplacing) {
      void logRecord({
        event: 'ext.ws.replacing_relay',
        lvl: 'warn',
        reason: 'reconnect_before_old_close',
      });
    }
    teardownRelay();

    // Generation token (RCA 2026-07-06 §4 item 2): every callback below
    // captures `myGen` and no-ops if a NEWER openRelay() call has since
    // superseded it. Structurally prevents a stale callback — from ANY close
    // path — from mutating shared state (`relay`, `context`, `heartbeat`) out
    // from under the current, live attempt.
    const myGen = ++relayCallGeneration;
    const isStale = () => myGen !== relayCallGeneration;

    void logRecord({ event: 'ext.ws.connect.attempt', url: currentUrl });
    relay = createRelay({
      onOpen() {
        if (isStale()) return;
        void logRecord({ event: 'ext.ws.open', url: currentUrl });
        // Wait for server_info before dispatching WS_OPEN
        serverInfoTimer = setTimeout(() => {
          if (isStale()) return;
          serverInfoTimer = null;
          void logRecord({
            event: 'ext.ws.server_info_timeout',
            lvl: 'warn',
            timeoutMs: SERVER_INFO_TIMEOUT_MS,
            url: currentUrl,
          });
          // disconnect() (not discard()) — this relies on the real onclose
          // firing to dispatch WS_CLOSE and scheduleBackoff(). Do not change
          // this call to discard()/nulled-handlers; see relay-client.ts.
          relay?.disconnect();
        }, SERVER_INFO_TIMEOUT_MS);
      },

      onServerInfo(info: ServerInfo) {
        if (isStale()) return;
        // server_info reached → the open attempt is decided; release the lock so
        // a competing life isn't narrowed out longer than necessary.
        releaseLock();
        if (serverInfoTimer !== null) {
          clearTimeout(serverInfoTimer);
          serverInfoTimer = null;
        }
        const versionStatus = checkBridgeVersion(info.version);
        // Detect bridge generation change. When the bridge restarts, its
        // PID changes. The previously-cached serviceStatus snapshot (from
        // a slow helper invoke) might still reference the OLD pid — that
        // would cause the diagnostics panel to show stale data ("Helper
        // version: 0.5.7" when bridge is now 0.5.8). Force a fresh helper
        // status fetch when we detect a PID change so the side panel UI
        // converges quickly.
        const prevPid = context.serverInfo?.pid;
        const pidChanged = prevPid !== undefined && prevPid !== info.pid;
        context = {
          ...context,
          serverInfo: info,
          lastConnectedAt: Date.now(),
          lastVerifiedAt: Date.now(),
          versionStatus,
          // Clear diagnosticReason on successful connection. Previously,
          // a stale `bridge_not_started` (from a discovery cycle that
          // happened just before the WS opened) would persist forever
          // because setDiagnostic('connecting') only fired on the next
          // refreshUrl call, which can be 30s away.
          diagnosticReason: null,
          // §6.1: do NOT reset failureCount on server_info. A connection that
          // receives server_info but dies within seconds (the relay-storm
          // signature) must still count as a failure so backoff climbs. The
          // reset happens only once the link is STABLE (first HEARTBEAT_OK),
          // handled in the connection-machine 'connected' case.
          missedHeartbeats: 0,
        };
        if (pidChanged) {
          void logRecord({
            event: 'ext.bridge.pid_changed',
            lvl: 'info',
            previousPid: prevPid,
            currentPid: info.pid,
            currentVersion: info.version,
          });
          // Force a discovery refresh so the helper status snapshot
          // catches up to the new bridge generation.
          void refreshUrl();
        }
        void logRecord({
          event: 'ext.ws.server_info',
          bridgePid: info.pid,
          bridgePort: info.port,
          bridgeVersion: info.version,
          bridgeBuildId: info.buildId,
          versionStatus,
          uptime: info.uptime,
        });
        // Flush any pending log entries (e.g. from a previous SW life that
        // died before reconnecting). The bridge gets a single batch and
        // writes them to extension.log alongside its own bridge.log.
        flushPending(sendLogBatch).then((n) => {
          if (n > 0) {
            void logRecord({ event: 'ext.log.flushed', flushed: n });
          }
        });
        // Periodic flush so current-session events reach extension.log
        // without waiting for a reconnect.
        startLogFlushTimer();
        dispatch({ type: 'WS_OPEN' });
        startHeartbeat(myGen);
      },

      onPong(timestamp: number) {
        if (isStale()) return;
        heartbeat?.receivePong(timestamp);
        context = { ...context, lastVerifiedAt: Date.now() };
        dispatch({ type: 'HEARTBEAT_OK' });
      },

      onClose(code: number, reason: string) {
        if (isStale()) return;
        releaseLock();
        if (serverInfoTimer !== null) {
          clearTimeout(serverInfoTimer);
          serverInfoTimer = null;
        }
        stopLogFlushTimer();
        void logRecord({
          event: 'ext.ws.close',
          lvl: code === 1000 ? 'info' : 'warn',
          code,
          reason,
        });
        heartbeat?.stop();
        heartbeat = null;
        relay = null;

        // ── 4002: this (gen,lifeUuid) lost the bridge's total-order collision ──
        // A higher-identity relay for the same browserId superseded us. This is
        // TERMINAL for THIS identity: do NOT scheduleBackoff/reopen — reopening
        // would just re-challenge with the SAME (gen,lifeUuid), lose again, and
        // continue the storm with extra steps (design §6.4 / §7.1.3).
        //
        // It is terminal but SCOPED, never a global give-up:
        //   - We never persist a "gave up" flag; a future SW life loads with a
        //     fresh, higher genTimestamp and connects normally.
        //   - The guarded alarm retry in reconcile() can mint a fresh identity
        //     and reconnect, but ONLY when /api/state confirms no live relay
        //     exists for this browserId — so we never re-challenge a healthy
        //     winner (design §8.2). Until then we sit quietly in
        //     'awaiting_sw_recovery' (a real state, NOT a lying "Connected").
        if (code === 4002) {
          context = {
            ...context,
            serverInfo: null,
            // Move out of any connected/degraded state into reconnecting WITHOUT
            // scheduling a backoff reopen — reconcile()'s guarded retry owns
            // recovery from here.
          };
          void logRecord({
            event: 'ext.ws.relay_superseded_terminal',
            lvl: 'warn',
            code,
            reason,
            gen: relayGenTimestamp,
            hint: 'Bridge rejected this relay identity (4002): a higher (gen,lifeUuid) won. Terminal for this SW life; alarm re-challenge is guarded on bridge liveness.',
          });
          dispatch({ type: 'WS_CLOSE' });
          setDiagnostic('awaiting_sw_recovery');
          return;
        }
        // Drop the cached serverInfo on close: the previously-connected
        // bridge generation is now gone, and continuing to display its
        // PID / port / uptime would be a lie. The diagnostics panel will
        // show "—" / "N/A" until the next bridge sends a fresh server_info.
        // (Previous behavior kept the stale serverInfo and showed it as
        // "Server PID: <old-pid>, Uptime: <duration-of-old-connection>"
        // which confused users — see fix1-invalidate-stale.)
        context = {
          ...context,
          serverInfo: null,
          // Keep lastConnectedAt — it's still useful as "last successful
          // connection", e.g. "Last connected: 30s ago".
        };
        // Set diagnostic immediately — don't wait for next discovery cycle
        if (context.lastConnectedAt !== null) {
          setDiagnostic('was_connected');
        }
        dispatch({ type: 'WS_CLOSE' });
        // Schedule backoff if we're in reconnecting state
        if (context.state === 'reconnecting') {
          scheduleBackoff();
        }
      },

      onError(_error: Event) {
        if (isStale()) return;
        // WebSocket onerror events deliberately carry no diagnostic detail
        // (browser security). Logging the type tag is the most we can do.
        void logRecord({
          event: 'ext.ws.error',
          lvl: 'warn',
          state: context.state,
          diagnosticReason: context.diagnosticReason,
        });
        if (context.state === 'connecting') {
          // If diagnostic was 'connecting' (lock file said server exists), but WS failed → server not responding
          if (context.diagnosticReason === 'connecting') {
            setDiagnostic('server_not_responding');
          }
          dispatch({ type: 'WS_ERROR' });
          // Safety: if onClose doesn't fire after onError, ensure backoff is scheduled.
          // Some WebSocket implementations may not fire close after error. The
          // dispatch() above may have transitioned state to 'reconnecting'; TS
          // can't follow state-machine transitions through dispatch, so cast.
          if ((context.state as ConnectionState) === 'reconnecting') {
            scheduleBackoff();
          }
        }
      },

      onToolRequest(id: string, tool: string, params: Record<string, unknown>) {
        if (isStale()) return;
        void logRecord({
          event: 'ext.tool_request.received',
          requestId: id,
          tool,
          params,
        });
        options.onToolRequest?.(id, tool, params);
      },

      onToolScan(tools) {
        if (isStale()) return;
        options.onToolScan?.(tools);
      },
    });

    // §6.5: narrowly hold the relay lock around this open attempt (best-effort).
    acquireRelayLock();
    relay.connect(withRelayRole(currentUrl));
  }

  // `gen` ties this heartbeat's callbacks to the relay generation that
  // started it (same generation-token discipline as the relay callbacks in
  // openRelay() — see the field comment on `relayCallGeneration`). Without
  // this, a heartbeat interval tick that was already queued the instant a
  // NEWER relay superseded this one could still fire onMiss()/onDead() and
  // call `relay?.disconnect()` on the new, live relay.
  function startHeartbeat(gen: number): void {
    heartbeat = createHeartbeatMonitor(DEFAULT_HEARTBEAT_CONFIG, {
      sendPing() {
        if (gen !== relayCallGeneration) return;
        relay?.sendPing(Date.now());
      },
      onMiss() {
        if (gen !== relayCallGeneration) return;
        void logRecord({
          event: 'ext.heartbeat.miss',
          lvl: 'warn',
          missedCount: heartbeat?.getMissedCount() ?? 0,
        });
        dispatch({ type: 'HEARTBEAT_MISS' });
      },
      onDead() {
        if (gen !== relayCallGeneration) return;
        void logRecord({
          event: 'ext.heartbeat.dead',
          lvl: 'warn',
          missedCount: heartbeat?.getMissedCount() ?? 0,
        });
        dispatch({ type: 'HEARTBEAT_MISS' });
        // disconnect() (not discard()) — inverse-case guard: relies on the
        // real onclose to dispatch WS_CLOSE and scheduleBackoff(). See
        // relay-client.ts and the RCA's naive-fix warning.
        relay?.disconnect();
      },
    });
    heartbeat.start();
  }

  return {
    async connect(url?: string): Promise<void> {
      currentUrl = url ?? DEFAULT_URL;
      dispatch({ type: 'CONNECT' });
      // Always try discovery before connecting — the lock file may have
      // a different port than DEFAULT_URL, and native host may not be running yet
      await refreshUrl();
      openRelay();
    },

    disconnect(): void {
      // stopAll() already discards and nulls `relay` — nothing left to do
      // here (dead code removed per RCA 2026-07-06 §4 item 6: the old
      // `if (relay) { ...; r.disconnect(); }` below this could never run).
      stopAll();
      dispatch({ type: 'DISCONNECT' });
    },

    retry(): void {
      stopAll();
      dispatch({ type: 'CONNECT' });
      refreshUrl().then(() => openRelay());
    },

    async reconcile(): Promise<void> {
      // Layer 2/3/6: Verify in-memory relay matches persisted state.
      // Called by alarm, SW init, and verify_connection message.
      if (relay !== null && relay.isConnected()) {
        // Relay alive in memory — send a ping to confirm and update lastVerifiedAt
        relay.sendPing(Date.now());
        return;
      }

      // ── CONNECTING-aware guard (RCA 2026-07-06 §4 item 4 / defect 2) ──────
      // A connect attempt is already in flight. reconcile() previously
      // treated anything short of OPEN as "dead" and tore it down via
      // stopAll()+openRelay() — including a socket mid-handshake. That gave
      // the 5s side-panel fast-poll and the 30s alarm a SECOND, uncoordinated
      // reconnect driver racing openRelay()'s own backoff cycle: exactly the
      // storm shape in the RCA. Wait instead — bounded by relay-client's own
      // CONNECTING-phase timeout, so this can never hang forever either.
      // Single-flight is derived from state (`relay.isConnecting()`), not a
      // hand-rolled boolean flag.
      if (relay !== null && relay.isConnecting()) {
        void logRecord({
          event: 'ext.reconcile.connecting_in_flight',
          lvl: 'info',
          hint: 'A connect attempt is already CONNECTING; waiting instead of tearing it down (bounded by the relay-client CONNECTING-phase timeout).',
        });
        return;
      }

      // ── §8.2 guarded, time-scoped re-challenge after a 4002-terminal close ──
      // This life was superseded (lost the (gen,lifeUuid) total order) and is
      // sitting in 'awaiting_sw_recovery' with no relay and no scheduled
      // backoff. We must re-challenge ONLY when there is genuinely no live relay
      // for our browserId — confirmed from BRIDGE TRUTH (/api/state), NOT from
      // our own `relay === null` (always true here, says nothing about the
      // winner). Re-challenging a healthy winner would mint a fresh, HIGHER
      // identity and supersede it → a 30s-cadence slow storm (§8.1).
      if (context.diagnosticReason === 'awaiting_sw_recovery') {
        const liveness = await probeBridgeRelayLiveness();
        if (liveness === 'live') {
          // A healthy winner owns the browserId — stay quiet. The UI remains in
          // 'awaiting_sw_recovery'; we do NOT mint/connect.
          void logRecord({
            event: 'ext.reconcile.recovery_deferred',
            lvl: 'info',
            reason: 'live_relay_present_for_browserid',
            hint: 'A live relay exists for this browserId; not re-challenging the winner.',
          });
          return;
        }
        // No live relay (winner gone / stale / never present) → recover. Mint a
        // FRESH identity so the new challenge outranks any stale incumbent, then
        // reconnect through the normal path.
        mintFreshRelayIdentity();
        void logRecord({
          event: 'ext.reconcile.recovery_rechallenge',
          lvl: 'info',
          livenessProbe: liveness,
          newGen: relayGenTimestamp,
          hint: 'No live relay for this browserId; minting fresh identity and reconnecting.',
        });
        stopAll();
        await refreshUrl();
        // refreshUrl() mutates `context.diagnosticReason` via setDiagnostic; TS
        // narrows the closure `context` to the literal from the outer `if` and
        // cannot follow the reassignment through the await, so read it widened.
        const reasonAfter = (context as ConnectionContext).diagnosticReason as DiagnosticReason | null;
        if (reasonAfter === 'connecting') {
          dispatch({ type: 'CONNECT' });
          openRelay();
        } else if (context.state !== 'disconnected') {
          dispatch({ type: 'DISCONNECT' });
        }
        return;
      }

      // Relay is dead in memory. Attempt rediscovery regardless of persisted state.
      // This covers:
      //   - connected/degraded/reconnecting: persisted state is lying after SW resume
      //   - disconnected: the sidepanel fast-poll case — server was down, came back,
      //     but context stayed 'disconnected' because no reconnect was ever dispatched
      stopAll();
      await refreshUrl();

      // If discovery found a live server (diagnostic === 'connecting'), try to reconnect
      if (context.diagnosticReason === 'connecting') {
        dispatch({ type: 'CONNECT' });
        openRelay();
      } else if (context.state !== 'disconnected') {
        // Server not found and we were supposedly connected — surface the break
        dispatch({ type: 'DISCONNECT' });
      }
    },

    isRelayAlive(): boolean {
      return relay !== null && relay.isConnected();
    },

    getContext(): ConnectionContext {
      return context;
    },

    getRelay(): Relay | null {
      return relay;
    },

    onStateChange(listener: (ctx: ConnectionContext) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
