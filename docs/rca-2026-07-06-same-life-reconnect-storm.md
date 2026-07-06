# RCA + Fix Spec: same-life reconnect storm (self-inflicted 5s WS churn)

**Date:** 2026-07-06
**Branch:** `multi-client-architecture`
**Status:** Spec approved (three-pass expert review); implementation pending
**Severity:** High — kills/blocks MCP tool calls while active; invisible to the Flapping verdict by design

---

## 1. Incident summary

Two live production occurrences on the dev machine (2026-07-05 evening, and again
overnight into 2026-07-06). Symptom seen by the user: `list_tabs` failed with
`browser_socket_replaced_mid_request`; UI implied "Chrome disconnected."

Reality: Chrome never disconnected and the bridge ran continuously for hours.
The extension service worker was stuck **reopening its own WebSocket every ~5
seconds, indefinitely** (1,587+ reconnects in one window; a second storm on a
different Chrome window the next day). Every reconnect hit the bridge's
exact-identity-tie ("idempotent") path, which still terminates the old socket
and rejects all in-flight tool requests.

### Log signature (how to recognize it)

- `bridge.log`: `bridge.browser.relay_reconnect_idempotent` with
  `reason:exact_identity_tie` repeating every ~5–6s, **same `gen` every time**
  (`gen` is `Date.now()` minted once per SW life — a constant `gen` across an
  hour proves one SW life looping, not competing lives).
- `extension.log` (when it flushes at all — see §5): per cycle
  `ext.ws.connect.attempt → ext.ws.open → ext.ws.close code:1006 (~18ms later)
  → ext.ws.server_info (versionStatus ok)`.
- Live SW console (the ground truth that closed the RCA):
  `WebSocket is closed before the connection is established.` with caller
  `disconnect @ background.js` — i.e. the **extension closes its own socket
  while it is still CONNECTING**.
- Tool failures: `browser_socket_replaced_mid_request` (in-flight when a
  reconnect lands) or `No browser extension connected` (no OPEN socket at
  dispatch time).

## 2. Root cause (confirmed, extension-side, self-inflicted)

Two defects in `packages/extension/src/background/` combine into a
self-sustaining loop:

### Defect 1 — `relay-client.ts disconnect()` leaves `onclose` wired

`connect()` replaces an old socket safely (`ws.onclose = null; ws.close();
cleanup()` — relay-client.ts:97-101). `disconnect()` (:121-125) does **not**
null `onclose` before `ws.close()`. `openRelay()`
(connection-manager.ts:327-335) uses `disconnect()` for its "close old before
opening new" step, so the OLD socket's `onclose` fires asynchronously **after
the new socket is already connecting**:

1. stray `onclose` → dispatches spurious `WS_CLOSE`, sets shared `relay = null`
   unconditionally (connection-manager.ts `onClose`, ~:447)
2. state → `reconnecting` → `scheduleBackoff()` (:502-503)
3. backoff is pinned at its 5s cap (`MAX_BACKOFF`, backoff-manager.ts) because
   the connection never survives to the first heartbeat (20s), so
   `failureCount` never resets (connection-machine.ts §6.1 rule)
4. backoff fires `openRelay()` again → `disconnect()`s the NEW still-CONNECTING
   socket ("closed before the connection is established") → GOTO 1

Rock-steady ~5s cadence, no escape hatch.

### Defect 2 — `reconcile()` treats CONNECTING as dead

`reconcile()` (connection-manager.ts:607) guards on `relay.isConnected()`,
which is `readyState === OPEN` only (relay-client.ts:144-146). A socket
mid-handshake reads as dead → `stopAll()` → `openRelay()`. There is no
"connect already in flight, wait" concept. The 5s side-panel fast-poll and the
30s alarm both drive `reconcile()`, giving a second reconnect driver
uncoordinated with backoff's own timer.

### Aggravator — the bridge makes each reconnect destructive

`indexBrowser()` (native-host service.ts:187-243): on ANY reconnect for a
registered browserId — including the exact-identity idempotent tie — it
`.terminate()`s the old socket (→ the 1006 the extension logs) **and rejects
every in-flight request** with `browser_socket_replaced_mid_request`
(:230). The `idempotent` flag added in `6c97b51` only suppresses the churn
count and warn log, not the destruction.

### Why it was invisible

- `6c97b51` deliberately excluded idempotent ties from `supersededRecentCount`,
  so the Flapping verdict **never fires** for this storm shape.
- Extension logs are forwarded over the same WS that is dying every ~18ms, so
  they stop flushing to disk (and to Neon) exactly while the storm is active.
- No decision-layer events exist (close-initiator, state transitions), so even
  flushed logs cannot distinguish "I closed it" from "it was closed on me."

## 3. Provenance — did we introduce it?

Yes, on **2026-06-25** (relay-storm fix line of work):

- `0058bf4` — deterministic `(gen,lifeUuid)` collision identity. Correctly
  killed the original cross-life 4002 supersede storm; sanctioned the
  "idempotent same-life reconnect" category while leaving it wired to
  terminate-and-reject.
- `6c97b51` — "idempotent reconnects not churn." Commit message states it
  "still terminat[es] the orphaned socket and fail[s] its in-flight requests."
  Also removed this storm shape from observability.
- The design doc (`design-2026-06-25-relay-storm-fix-expert-review.md` §6.1)
  declared "retry at 5s forever" an acceptable self-throttle — valid only when
  the retried condition is external and eventually clears. Here the condition
  is the client's own code, so it never clears. §11.2's "that socket is
  genuinely gone" assumption is disproven by this incident.

The latent asymmetric `connect()`/`disconnect()` handler handling in
relay-client.ts predates those commits; the 06-25 work is what made the loop
reachable, silent, and destructive.

## 4. Fix plan — three phases, strictly in this order

Sequencing rationale (expert-reviewed, adversarially validated): Phase 1
removes the generator; Phase 2 hardens the consumer; Phase 3 restores
visibility. Phase 2+3 alone is NOT sufficient: it only closes the
"already-dispatched request killed by explicit rejection" sub-case, leaving
(a) `No browser extension connected` when no socket is OPEN at dispatch,
(b) silent response drops from `relay` being nulled under a live handler, and
(c) an observability-invisible permanent churn loop that risks SW eviction
mid-storm (which would bootstrap a genuine cross-life storm on top).

### Phase 1 — extension: stop the storm (root cause)

All in `packages/extension/src/background/`. **Important corrections from
adversarial review — the naive fix ("null onclose inside disconnect()") is
WRONG and must not be shipped:** the server_info-timeout path
(connection-manager.ts:349) and heartbeat `onDead()` (:572) *rely* on
`onClose` firing to dispatch `WS_CLOSE` and call `scheduleBackoff()`.
Suppressing it there degrades recovery from ~1–5s to the 30s alarm, silently.

1. **`relay-client.ts`: add a distinct `discard()` method** — nulls
   `onopen/onclose/onerror/onmessage`, closes, cleans up (mirrors `connect()`'s
   existing safe replace at :97-101). Route it ONLY through the two genuine
   replace sites: `openRelay()`'s pre-replace block and `stopAll()`. Leave
   `disconnect()` semantics untouched for the timeout and heartbeat callers.
2. **Generation token on relay callbacks (fix-the-class):** each
   `connect()` mints a monotonic generation; every callback captures it and
   no-ops if it is not the current generation when it fires. Makes stale
   callbacks structurally impossible regardless of which close path was used.
3. **CONNECTING-phase timeout in `relay-client.connect()`:** confirmed gap —
   `serverInfoTimer` only starts after `onopen`; nothing bounds a socket stuck
   in CONNECTING (SYN black-holed). Add a 10–15s timer at socket creation; on
   expiry force-close and synthesize a failure event.
4. **CONNECTING-aware `reconcile()` guard:** if a relay exists and its socket
   is CONNECTING, treat as "attempt in flight — wait" (bounded by #3), do not
   tear down. Derive single-flight from state; no hand-rolled boolean flag.
5. **Unify `openRelay()`'s pre-replace teardown with `stopAll()`'s** (timers +
   heartbeat + relay together) — closes a `serverInfoTimer` leak on the direct
   `openRelay()` path and provides the re-entrancy guarantee for free.
6. Clean up dead code at connection-manager.ts:591-595 (`if (relay)` after
   `stopAll()` already nulled it).

### Phase 2 — bridge: reconnects must never kill tool calls (defense-in-depth)

`packages/native-host/src/service.ts indexBrowser()`:

- On an **exact-identity idempotent tie**: do NOT reject `pendingRequests`
  (responses resolve by request id off any wired socket — verify
  service.ts:606-613 before relying on this); do NOT hard-`.terminate()` —
  re-index `browserSockets[browserId] = newSocket` immediately (new requests
  route correctly), give the old socket a short bounded grace (2–3s) then
  `close(1000, 'superseded_idempotent')`.
- Keep terminate-and-reject for genuine (different-identity) supersedes — a
  new SW life truly cannot answer the old life's requests.
- Requires binary recompile + release per CLAUDE.md release rules.

### Phase 3 — observability: make the next storm legible in minutes

- Extension: log close-initiator (self-discard / self-disconnect / remote),
  state-machine transitions, and heartbeat outcomes.
- Bridge: `bridge.browser.flash_close` warn when a socket closes <250ms after
  connect; track idempotent-tie recurrence **rate** as its own signal
  (separate from `supersededRecentCount`) and surface it in the truthful
  verdict ("Reconnecting rapidly — tool calls may be failing").
- Extension log flush path that survives WS death (buffer to
  `chrome.storage`, flush on reconnect), so logs and Neon are not blind
  exactly when the connection is sick.

## 5. Test plan (red → green; inverse cases mandatory)

Phase 1 (extension unit + integration):
- RED before fix: rapid double `openRelay()` must not dispatch a spurious
  `WS_CLOSE` from the discarded socket.
- RED before fix: `reconcile()` during CONNECTING must not tear down the
  in-flight attempt.
- **Inverse (regression guard for the naive fix):** heartbeat `onDead` and
  server_info timeout must still lead to `scheduleBackoff()`/reopen promptly —
  a future "null handlers inside disconnect()" change must fail this test.
- Generation token: a stale callback firing after a new `connect()` is a
  no-op.
- CONNECTING timeout: socket that never opens is force-failed within the bound.
- Storm convergence: simulated repeated open→close cycles end with the
  connection latched OPEN and heartbeat established, not a fixed-cadence loop.

Phase 2 (bridge unit + e2e):
- Pending request survives a same-identity reconnect; a late `tool_response`
  still reaches the MCP caller.
- Genuine different-identity supersede still terminates + rejects (inverse).
- No socket leak after 50 same-identity reconnects (bounded open-socket count).
- E2E with a real bridge + scripted WS client (non-mocked), per repo law.

Live validation: the storm reproduces on the dev machine — after Phase 1,
rebuild the extension, reload it, and confirm in `bridge.log` that
`relay_reconnect_idempotent` stops recurring and the connection stays latched
(plus SW console clean). Then a multi-hour soak (`repo.md`) with a new hard
gate: zero flash-close loops / zero idempotent-tie storms.

## 6. References

- `docs/design-2026-06-25-relay-storm-fix-expert-review.md` (§6.1, §11.2 —
  assumptions this incident disproved)
- Commits: `0058bf4`, `6c97b51`, `4362fb2` (v0.5.16)
- Key code: `relay-client.ts:97-101` vs `:121-125`;
  `connection-manager.ts:318-350, :432-505, :604-676`;
  `backoff-manager.ts` (MAX_BACKOFF); `heartbeat-monitor.ts`;
  native-host `service.ts:187-243, :606-613, :715-727`
