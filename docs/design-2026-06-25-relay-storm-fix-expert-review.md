# Relay-supersede storm — diagnosis, fix proposal & expert review (2026-06-25)

Status: **design / not yet implemented.** Investigation only — no code changed.

This captures the `browser_socket_replaced_mid_request` outage, the proposed fix,
and the reviews from the repo's two expert subagents
(`.claude/agents/full-stack-engineer.md`, `.claude/agents/ui-ux-engineer.md`),
which corrected the proposal in two material ways. The **refined plan** is at the
bottom.

---

## 1. The bug (diagnosed from logs)

Every MCP tool call returns `browser_socket_replaced_mid_request`, while the side
panel shows a confident **"Connected"** (port listening, protocol v0.5.14,
heartbeat on time).

**Mechanism.** Every ~1.3 s a new `?role=relay` socket for the same persisted
`browserId` (`chrome:5d266380…`) supersedes the live relay:
`bridge.browser.relay_superseded` → `bridge.browser.connected` →
`bridge.browser.replaced`. `service.ts indexBrowser()` terminates the old socket
and rejects all its in-flight requests. Because a fresh relay supersedes the
previous one faster than any real call completes, **no request ever finishes.**

**Why the panel lies.** Diagnostics bind to bridge-side liveness
(port/protocol/heartbeat). The bridge always has *a* live socket and an on-time
heartbeat — just a different one every second. Green means "bridge is up," not
"a socket survives a request." Same class as the prior green-but-zero-tabs RCA.

**Environmental aggravators:** two bridge processes (one zombie with no listening
port from a lost bind race); version skew (helper v0.5.10, bridge+extension
v0.5.14, released v0.5.15).

---

## 2. Original proposed fix (three layers)

1. **Root cause:** acquire a Web Lock (`navigator.locks.request('agenthub-relay',
   …)`) before `openRelay()`; only the lock holder opens the socket. Overlapping
   SW lives block until the holder is evicted → one relay per browser.
2. **Bridge backstop:** detect supersede ping-pong (same browserId superseded N
   times in a window) and converge — pin one incumbent, reject the flapping
   newcomer with 4002.
3. **Hygiene + observability:** reconcile version skew; make the bind-race loser
   bridge exit; add a real tool-path signal to diagnostics so "Connected"
   reflects request survival.

---

## 3. Expert review — full-stack-engineer (backend)

**Root cause confirmed, one of my assumptions killed:**
- Two overlapping MV3 SW lives is the real mechanism. A *single* SW can't
  ping-pong itself — its `openRelay` closes its own old relay first
  (`connection-manager.ts:200-208`). The precondition is the **persisted
  `browserId`** shared across all SW lives (`browser-instance-id.ts:52-76`).
- **The probe↔relay correlation is a red herring.** The helper-probe is exempt
  (`service.ts:545 !isProbe`, probe uses `browserId=helper-probe`,
  `service-status.ts:155`). The storm is pure relay-vs-relay.

**Corrections to the fix:**
1. **Web Lock — right primitive, but do NOT hold it for the session.** A
   wedged-but-alive SW (JS alive, heartbeat dead) holding a session-length lock
   would starve the healthy life — a storm becomes a deadlock, and MV3 wedge is
   exactly what this subsystem exists to recover from. Hold the lock **narrowly**
   (around open until `server_info`). By itself the lock only *narrows* the
   storm.
2. **Reject the "N supersedes in a window" backstop.** It's a heuristic that
   violates decide-by-identity-not-count, and re-creates the v0.5.11 4002 loop
   (a real fresh SW life gets rejected because the counter is hot). **Replace it
   with a persisted monotonic generation token** (`?gen=<n>` from
   `chrome.storage.local`, incremented per SW life) alongside `role=relay`. The
   bridge collision rule becomes a total order: **higher gen wins; equal gen is
   idempotent (replace silently); lower gen → 4002.** Monotonic ⇒ converges; the
   older life's reopened sockets carry a lower gen and are rejected — storm stops
   in one cycle. Use a *persisted counter* (survives eviction), not a per-load
   UUID.
3. **Highest inverse-case risk (must fix):** the extension must treat a **4002 on
   the relay as terminal — no backoff/reconnect.** Today any non-1000 close →
   `scheduleBackoff` (`connection-manager.ts:307, 333`); without a special case
   the rejected lower-gen life reopens and the storm continues with extra steps.

**Full state space the fix must not break:** legit fast reconnect after real
eviction (higher gen must win immediately, no liveness delay); multi-profile
fan-out (lock name is global to the agent, each profile is a separate agent →
no cross-profile contention; keep epoch state keyed by `browserId`); helper-probe
stays exempt; 4002-for-lower-gen is safe *only* with the terminal-close handling.

**Real regression test:** extend `tests/e2e/chaos-connection.spec.ts` — inject two
concurrent `role=relay` sockets for the same browserId with increasing gen, each
reopening on close; start a >2 s tool_request during contention; assert (a) it
completes (no `browser_socket_replaced_mid_request`); (b) `relay_superseded`
converges to ≤1 in a 5 s window; (c) the lower-gen socket gets 4002 and does NOT
reopen. Inverse: a genuine higher-gen reconnect still supersedes <1.5 s; two
distinct browserIds both stay connected; helper-probe ignored. Must be real
bridge + real sockets — a mocked WS cannot catch close-timing.

**Verdict:** modify, don't ship as-is. Single highest-value change = **persisted
gen token + bridge total-order on gen + 4002-is-terminal**. That is the root fix
(deterministic, identity-based, no MV3-lock-timing assumptions); the Web Lock is a
secondary guard against intra-profile concurrent opens. The gen token also serves
as the instrument that *proves* the two-SW theory from the live log.

Key files: `service.ts:544-576` (collision guard), `:187-227` (`indexBrowser`),
`:1670-1677` (router); `connection-manager.ts:23-26` (`withRelayRole`), `:299-336`
(onClose/backoff); `browser-instance-id.ts`.

---

## 4. Expert review — ui-ux-engineer (the status lie)

**Exact source of the lie:** `getDisplayState` (`types.ts:72`) upgrades to
"connected" on `lastVerifiedAt`, which is bumped by `onServerInfo`/`onPong`
(`connection-manager.ts:259, 295`). **A pong is not a tool round-trip** — it rides
the very socket being superseded and keeps arriving on each fresh 1.3 s socket, so
the heartbeat stays "on time" through a total outage.

**Correction:** **don't make a synthetic round-trip the primary signal** — it's
expensive and can itself be superseded mid-flight. **The truthful signals already
exist in `/api/state`**, which the panel already fetches
(`diagnostics-panel.tsx:333`) then discards (keeps only `data.bridge`): the
discarded `recentActivity.requests[].status` (`error|timeout|success`),
`recentActivity.rejections`, `browsers[].liveness` / `lastSeenAgeSec`, plus the
client-held `reconnectsThisSession`. Bind "Working" to a **real recent request
success**, not a heartbeat.

**Honest status model** (each state binds to a signal that already exists):

| State | Backing signal | Header | One next action |
|---|---|---|---|
| **Working** | `connected` AND a real request succeeded recently (OR `liveness='live'` + no recent failed/superseded requests for my browserId + reconnects flat) | "Connected — tools working" | none |
| **Connected, unverified** | `connected` but no tool call yet this session | "Connected — not yet tested" | "Run a quick check" (one synthetic `list_tabs`) |
| **Flapping / churning** | `reconnectsThisSession` rising (≥3 in ~15 s) OR `/api/state` requests failing with `browser_socket_replaced_mid_request` OR elevated `replaced` rate | "Connection keeps dropping" | "Restart bridge" |
| **Stale / wedged** | `browsers[me].liveness='stale'` (`lastSeenAgeSec>45`) | "Connection went quiet" | "Reconnect" |
| **Version mismatch** | three-way skew helper vs bridge vs extension | "Versions don't match" | "Copy update command" |
| **Rejected (origin)** | `recentActivity.rejections` contains my origin | "Bridge is refusing this extension" | "Copy update command with extension ID" |
| **Disconnected** | no lock / pid dead / port closed | existing | existing |

**Rule that fixes the lie:** "Working" must require a **tool-path fact, never a
heartbeat fact.** Default `connected` → "Connected (untested)"; upgrade to
"Working" only on a real success. The storm flips to **Flapping** from
`reconnectsThisSession` + `recentActivity` *before* any synthetic probe is needed.

**Copy — flapping:** "Connection keeps dropping — AgentHub reconnects to your
browser but each link gets replaced before a command can finish, so tools aren't
working right now. This usually clears up with a restart." → **Restart bridge.**

**Copy — version skew:** "Versions don't match — your AgentHub pieces are on
different versions (browser 0.5.14, helper 0.5.10, bridge 0.5.14). They work best
when they all match. Updating takes about a minute." → **Copy update command.**

**Accessibility & consistency:** never color-alone (distinct icon+text+ARIA for
flapping ↻ / stale ◌ / version ⚠); announce the *header title* transition in a
polite live region, not just the dot (`connection-header.tsx:300`); controls stay
enabled while broken (already true — preserve it); **unify the verdict** — the
header (`deriveHeader`) and panel (`buildSteps`) derive independently today, and
the dashboard already shows "stale" while the side panel says "Connected." One
`/api/state`-derived verdict for all three surfaces.

**Verify under the real fault:** induce the churn (chaos harness already seeds
it), drive a `list_tabs`, assert the header reads "Connection keeps dropping" and
the badge state is `flapping`, backed by `recentActivity` entries containing
`browser_socket_replaced_mid_request`; inverse: after a real success the panel
upgrades to "Working" only *after* the success, not on the next pong.

**Verdict:** keep "supersede rate" (free), **drop synthetic round-trip as the
backbone**, and **consume `/api/state recentActivity`** as the real backing for
"Working." Synthetic `list_tabs` only as an on-demand "Run a quick check."

Key files: `types.ts:72` (the lie), `diagnostics-panel.tsx:333` (fetches then
discards truth), `connection-header.tsx:31,43` (second independent derivation),
`diag-server.ts:61-85` (`RecentRequest.status`, `RecentRejection`),
`service.ts:1523-1543` (`liveness` already computed), `:202,:548` (churn events).

---

## 5. Refined plan (both experts)

1. **Root fix (backend):** persisted **generation token** on `role=relay`; bridge
   resolves collisions by gen **total-order** (higher wins / equal idempotent /
   lower → 4002); extension treats **4002-on-relay as terminal (no backoff)**.
   Replaces the heuristic backstop.
2. **Secondary guard:** Web Lock held **narrowly** around open (not the session) —
   prevents intra-profile concurrent opens without risking a wedge-deadlock.
3. **Truthful UI:** consume the `/api/state` fields already fetched; default to
   "Connected (untested)", upgrade to "Working" only on a real request success;
   add a **Flapping** state from `reconnectsThisSession`/replace-rate; unify the
   three surfaces; no new synthetic heartbeat.
4. **Hygiene:** zombie-bridge exit + version-skew reconciliation (aggravators, not
   the cause).
5. **Regression gate:** extend the real chaos harness to drive the two-relay storm
   and assert convergence + request survival + 4002-terminal + fan-out intact.

**Single highest-value change:** the persisted gen token + bridge total-order +
4002-is-terminal. It stops the storm deterministically in one cycle and is
identity-based, not heuristic.

Related: `docs/stability-assessment-2026-06-19.md`,
`docs/rca-2026-06-18-green-but-zero-tabs.md`.

---

## 6. Hardened version — third-pass principal-engineer review (2026-06-25)

The §5 refined plan is directionally correct and already removed the two worst
foot-guns (session-length lock, count-based heuristic). But it is **not yet
provably robust**: two holes in the generation scheme re-admit the *exact* storm
or convert it into a permanent disconnect. This section specifies the hardened
design an implementer should build instead of §5 item 1.

### 6.1 Independent corroboration of the diagnosis

The log forensics that motivated §1 were reproduced independently from the Neon
remote-log store and agree on every load-bearing point:

- `ext.ws.replacing_relay = 0` during the storm ⇒ each SW life is individually
  compliant (its own `openRelay()` closes its own relay first). The contention is
  **between two lives**, not within one — confirming the §3 mechanism.
- The trigger (a `1005` close ~0.5 s after `server_info`) is the *other* life's
  relay superseding this one at the bridge; it is **not** observable from any
  extension-side close path (`server_info_timeout`=10 s, heartbeat=20 s,
  alarm=30 s, fast-poll=5 s all far too slow). Diagnosis required correlating
  bridge + ext logs by **event time** (`fields->>'t'`), not ingestion time.
- The shared persisted `browserId` is confirmed: `getBrowserInstanceId()`
  (`browser-instance-id.ts:62-72`) reads/writes the UUID in
  `chrome.storage.local`, so every SW life of one browser context resolves the
  same id — the precondition for the collision.
- **Aggravator downgraded:** a storm was observed with a *single* bridge pid
  (one soak install, one listening pid, full storm). So "two bridge processes"
  is **not** a precondition — the cause is two SW lives + shared browserId. The
  zombie bridge only adds noise.

**Latent amplifier (must also fix, orthogonal to the gen scheme):** the reconnect
backoff never escalates during the storm because **`failureCount` is reset to 0
on every `server_info`** (`connection-manager.ts:254`) and again by `refreshUrl()`
whenever the bridge is reachable (`:184`). Each ping-pong cycle briefly succeeds
(receives `server_info`), so `calculateBackoff(0)` stays at its ~1 s floor and the
loop runs at full speed. Even after the gen fix stops the *collision*, this makes
any *future* flapping condition (transport, wedge, partial success) a full-rate
storm instead of a backing-off retry. **Fix:** only reset `failureCount` after a
connection has been *stable* (survived ≥ one heartbeat / ≥ N seconds), not on
`server_info` arrival. A connection that drops within seconds must count as a
failure so backoff climbs to the 5 s cap and the system self-throttles.

### 6.2 Hole 1 — generation assignment races; "equal gen" re-admits the storm

`gen` is incremented per SW life via read→modify→write on
`chrome.storage.local`, which is **not atomic**. The bug's precondition is two SW
lives starting near-simultaneously: both read `gen=5`, both write `6`, both
connect with `gen=6`. The §3/§5 bridge rule for equal gen is "idempotent — replace
silently" (**no 4002**). So the terminated socket reopens with the same gen, is
silently replaced again, reopens… **the ping-pong continues**, now amplified by
the §6.1 backoff defect. The fix's correctness silently depends on `gen` being
*strictly different* between concurrent lives, yet the serializing Web Lock is
described as a "secondary guard" and is not in the gen-assignment path.

**Hardening — make the order total so equal-primary still yields a strict winner.**
Each SW life also generates a one-time random `lifeUuid` (per load, not persisted).
The relay connects with both `?gen=<n>&lifeUuid=<uuid>`. The bridge collision rule
becomes a **lexicographic total order on `(gen, lifeUuid)`**:

- higher `gen` wins;
- equal `gen` → higher `lifeUuid` wins (deterministic, stable tiebreak);
- the loser is **always** rejected with `4002` — there is **no "silent
  idempotent replace"** branch anymore.

Because the order is total, two concurrent lives that raced to the same `gen`
still resolve to exactly one winner, and the loser gets `4002` (terminal, see
§6.4) → storm stops in one cycle. This **removes the dependency on atomic
increment / on the Web Lock for correctness** (the lock becomes a pure
optimization that narrows the window, never a correctness requirement).

### 6.3 Hole 2 — a persisted counter rolls back and inverts the order

A bare persisted monotonic counter resets to 1 on extension update, profile
reset, or "clear browsing data." A stale wedged life still holding `gen=50` then
outranks the *real* new life at `gen=1`; the bridge `4002`s the real life; and
because `4002` is terminal, the **extension gives up — dead until the next SW
cycle.** Rollback inverts the total order into a permanent lockout.

**Hardening — make the generation rollback-resistant.** Use a composite
generation `(startupEpochMs, counter)` compared as a tuple, OR a
**startup-timestamp generation** (`gen = Date.now()` captured at SW start,
persisted for the life). A timestamp generation is strictly better on two axes:

- **race-free:** two lives starting milliseconds apart get different values with
  no shared read-modify-write at all;
- **rollback-free:** a `chrome.storage.local` wipe does not lower a wall-clock
  timestamp the way it resets a counter.

Its only failure mode is the wall clock moving backwards (NTP correction, manual
change) — a strictly narrower exposure than the counter's race **and** rollback.
Combined with the §6.2 `lifeUuid` tiebreaker, the final relay identity is
`(genTimestamp, lifeUuid)` — total, race-free, rollback-resistant.

### 6.4 Hole 3 — "4002-is-terminal" must be scoped, not global

Terminal is correct for breaking the loop but must mean **"this socket / this
`(gen, lifeUuid)` stops retrying,"** never "this extension gives up." Invariants:

- A subsequent **genuine new SW life** (new, higher generation) MUST always be
  able to connect — never persist a global "gave up" flag that survives a new
  life.
- Do **not** route `4002` through the generic `scheduleBackoff` path
  (`connection-manager.ts:307, 333`) — that is what would otherwise reopen the
  loser and continue the storm with extra steps. Add an explicit terminal branch
  in `onClose` for close code `4002`.
- **Residual, must be stated + tested:** if the winner later dies and the only
  other life was `4002`-terminal'd, recovery waits for the next SW restart. This
  is acceptable *only* because MV3 cycles service workers frequently; it is an
  assumption, not an accident.

### 6.5 Web Lock — pure optimization, with safe semantics

With §6.2 the lock is no longer load-bearing. Keep it only as a window-narrowing
optimization around `open → server_info`, and acquire it with
`navigator.locks.request(name, { ifAvailable: true }, …)` (or a short timeout) so
a wedged holder can **never** hard-block a competing life. If the lock is
unavailable, proceed anyway — the `(gen, lifeUuid)` total order still guarantees
single-winner convergence at the bridge. Lock name is global to the agent; each
profile is a separate agent, so there is no cross-profile contention. Epoch/gen
state on the bridge stays keyed by `browserId`.

### 6.6 Truthful UI — endorsed as written (§4)

No changes. Binding "Working" to a real tool-path success (not a heartbeat/pong),
adding a **Flapping** state from `reconnectsThisSession`/replace-rate, and unifying
the header/panel/dashboard verdict from one `/api/state`-derived source are all
correct and high-value. Just ensure the single unified verdict is actually
consumed by all three surfaces (today they derive independently and already
disagree — dashboard "stale" vs side panel "Connected").

### 6.7 Hardened plan — what to implement

1. **Relay identity = `(genTimestamp, lifeUuid)`.** `genTimestamp` = persisted
   startup timestamp (rollback-resistant); `lifeUuid` = per-load random tiebreak.
   Send both on the `role=relay` upgrade.
2. **Bridge: total-order collision rule.** higher `(gen, lifeUuid)` wins; loser
   **always** `4002`; remove the "silent idempotent replace" branch.
3. **Extension: `4002`-on-relay is terminal and scoped** — explicit `onClose`
   branch, no backoff/reopen for that identity; a new SW life (new gen) still
   connects normally; never persist a global give-up.
4. **Fix the backoff amplifier (§6.1):** reset `failureCount` only after a
   connection is *stable* (≥ one heartbeat / ≥ N s), not on `server_info`.
5. **Web Lock as optimization only (§6.5):** narrow hold, `ifAvailable`/timeout,
   proceed-on-unavailable.
6. **Truthful UI (§4/§6.6).**
7. **Hygiene:** zombie-bridge exit + version-skew reconciliation (aggravators).

### 6.8 Regression gate — add two cases the §3 list misses

Extend `tests/e2e/chaos-connection.spec.ts` (real bridge + real sockets) with the
§3 assertions **plus**:

- **Equal-gen convergence:** inject two concurrent `role=relay` sockets with the
  **same `gen`** but different `lifeUuid`, each reopening on close. Assert they
  converge to exactly one survivor, the loser receives `4002` and does **not**
  reopen, and an in-flight >2 s `tool_request` completes (no
  `browser_socket_replaced_mid_request`). (Proves the §6.2 tiebreaker.)
- **Rollback resistance:** an incumbent with a **high** generation, then a new
  life with a **lower** generation (simulating a `chrome.storage.local` wipe).
  Assert the new life is **not** permanently locked out — i.e., generation is
  rollback-resistant (timestamp-based), so the newer life still wins/recovers.
  (Proves the §6.3 fix.)

### 6.9 Verdict

The §5 plan stops the *observed* collision but is **a better storm, not a
provably-stopped one**: hole 1 re-admits the full-rate ping-pong under the exact
concurrency the fix targets, and hole 2 can turn the fix into a permanent
disconnect. With the §6.7 hardening — **total order `(gen, lifeUuid)` with the
loser always `4002`, a rollback-resistant generation, scoped-terminal `4002`, and
the backoff-reset fix** — the mechanism becomes deterministic regardless of MV3
timing, storage atomicity, or clock, which is the bar for "robust." Implement §6,
not §5 item 1.

---

## 7. Fourth-pass review of §6 — corrections from full-stack + ui-ux (2026-06-25)

Both repo expert subagents re-reviewed §6 against the real code. **Verdict: §6 is
the right hardening and should be implemented over §5 — Hole 1 alone justifies it
(traced: `service.ts:553` → `indexBrowser` → `:214`, the equal-gen "silent
replace" re-emits `browser_socket_replaced_mid_request`).** But §6 overshoots in
three backend spots and its §6.6 "no UI changes" is wrong. Fold these in before
implementing.

### 7.1 Backend corrections (full-stack)

1. **§6.2 is too absolute — the EXACT tie must stay idempotent.** "No silent
   idempotent replace branch anymore" overshoots. An exact `(gen, lifeUuid)` match
   is the *same SW life's own transport-blip reconnect* (lifeUuid is per-load, not
   per-socket; `openRelay` already closed the old socket, `connection-manager.ts:200-208`).
   Rule must be: **strictly-lower `(gen,lifeUuid)` → 4002; exact tie → idempotent
   accept (no 4002); strictly-higher → accept + supersede.** Only the *strict*
   loser is rejected. Compare on strict inequality.
2. **§6.3 timestamp is contradictory and oversold — drop persistence.**
   "Captured at SW start" vs "persisted for the life" conflict, and a backward
   clock (NTP/manual) still lowers the value and inverts the order, so it is **not**
   "rollback-free" — only *narrower* than the counter. Cleaner and strictly more
   robust: identity = `(Date.now() at SW load, random lifeUuid)`, **both in-memory,
   neither persisted** — which also deletes the `chrome.storage` atomicity surface
   entirely (the `(startupEpochMs, counter)` composite is strictly worse).
3. **§6.4 "wait for next SW restart" is a real outage window — make terminal
   time-scoped.** Terminal must mean "this `(gen,lifeUuid)` stops retrying," and
   the existing ~30s reconcile/alarm (`connection-manager.ts:433`) should mint a
   **new** identity (fresh clock + lifeUuid) and retry, so a winner's death after
   the other life was 4002-terminal'd self-heals on the next tick instead of
   hanging on unpredictable MV3 eviction.
4. **Minor new hole — lifeUuid compare stability.** The lexicographic tiebreak is
   only a stable total order if the bridge compares the **raw query-param strings
   byte-for-byte** (no case-fold, no re-parse) on both sockets. Add one spec
   sentence + one chaos-test assertion.

### 7.2 UI corrections (ui-ux) — §6.6's "no changes" is wrong

§4's core rule (Working binds to a real tool-path success, never pong/heartbeat)
survives §6 untouched — and is now load-bearing for two more §6 failure modes.
But §6 **adds** UI work it didn't account for:

1. **New silent dead-window state.** §6.4 (winner dies, loser was 4002-terminal'd)
   = no live relay, but the extension is **not** in `reconnecting` (terminal 4002
   skips `scheduleBackoff`), so the panel sits **stale-green** — the exact
   green-but-zero-tabs class. Add a `Recovering` / `awaiting_sw_recovery` state
   (new `DiagnosticReason`), header copy "Reconnecting to your browser… usually
   fixes itself" → action **Reconnect now**, announced via the existing live
   region — must NOT read "Connected" during the window.
2. **Flapping must bind to the bridge replace-rate, not `reconnectsThisSession`.**
   §6.1 + the two-lives mechanism mean the churn is split across SW lives and
   largely invisible to any single SW's `reconnectsThisSession`
   (`connection-machine.ts:31`). Bind Flapping to the bridge-side
   `relay_superseded`/`replaced` rate (`service.ts:202,548`), which counts across
   both lives on one browserId; keep `reconnectsThisSession` only as a secondary
   corroborator.
3. **Both signals are missing from `/api/state` today** (they live only in
   `bridgeLog()`). §6 specified the collision mechanics but not the observability
   the truthful UI must consume. Small additive backend ask: a per-browser
   **supersede/replace counter** and a **last-relay-close-code / `lastRelayClosedAt`**
   on `StateSource.browsers[]` (`diag-server.ts:179-195`), plus one
   `DiagnosticReason` enum value.

### 7.3 Net

The two reviews cross-validate: the §6 backend hardening is correct, and it
exposes one UX state §6 left silent. Final implement-list = **§6.7 with the four
§7.1 backend corrections + the three §7.2 UI/observability additions**, and extend
the §6.8 regression gate with the lifeUuid-compare-stability assertion and a
"winner dies after loser was 4002-terminal'd → recovers within one alarm interval"
case.

---

## 8. Fifth-pass — one correction to §7.1.3 (principal-engineer, 2026-06-25)

§7 is accepted in full with one exception: **§7.1.3 as written re-admits a slow
storm.** The other corrections (§7.1.1 exact-tie idempotency, §7.1.2 in-memory
`(Date.now(), lifeUuid)`, §7.1.4 byte-for-byte compare, all of §7.2) are correct
and should be implemented as stated.

### 8.1 The gap in §7.1.3

§7.1.3 says a 4002-terminal'd life should let "the existing ~30 s reconcile/alarm
mint a **new** identity (fresh clock + lifeUuid) and retry." But the real
`reconcile()` (`connection-manager.ts:433-445`, verified) re-attempts on a purely
**local** predicate — *"Relay is dead in memory. Attempt rediscovery **regardless
of persisted state**."* It has **no knowledge of whether the other life is the
live winner.**

Failure trace with §7.1.3 unguarded:

1. Life A wins; life B is `4002`-terminal'd → B's `relay = null`.
2. B's next alarm (~30 s) → `reconcile()` sees a dead relay → rediscovers →
   `openRelay()` with a **fresh, higher** `Date.now()` identity.
3. By the §7.1.2 total order, B now **outranks the healthy A** → bridge supersedes
   A → A's `relay = null`.
4. A's next alarm does the identical thing to B.

Result: a **30 s-cadence ping-pong between two long-lived lives** — my §6.4
dead-window traded for a slow storm. The very property that makes §7.1.2 robust
(a retry always mints a *higher* identity) is what makes an *unconditional* retry
re-challenge a healthy winner.

### 8.2 The fix — gate the time-scoped retry on bridge truth, not local `relay===null`

A 4002-terminal'd life must re-challenge **only when there is genuinely no live
relay for its `browserId`**, confirmed from bridge truth — not from its own
`relay === null` (which is always true post-4002 and says nothing about the other
life).

- Before a terminal'd life mints a fresh identity in `reconcile()`, probe the
  bridge's per-browser liveness via `/api/state` (the **same** `lastRelayClosedAt`
  / supersede-counter / browser-`liveness` signal §7.2.3 is already adding — so
  this needs **no new** backend surface).
- If `/api/state` shows a **live** relay for this `browserId` → **stay quiet**
  (remain in the `awaiting_sw_recovery` state from §7.2.1; do **not** mint/connect).
- Only if `/api/state` shows **no live relay** (winner gone / stale) → mint a
  fresh `(Date.now(), lifeUuid)` and reconnect. This bounds recovery to one alarm
  interval **without** ever re-challenging a healthy winner.
- The existing terminal-vs-`scheduleBackoff` distinction is unchanged: 4002 still
  skips generic backoff (§6.4); this guard governs only the *alarm-driven*
  re-challenge, which is what makes "terminal" time-scoped instead of permanent.

This also tightens §7.2.1's UX state machine: the panel sits in `Recovering` /
`awaiting_sw_recovery` precisely while the guard holds the life quiet, and only
transitions to an active reconnect when bridge truth says the winner is gone — so
the UI never reads "Connected" during the window **and** never flaps green↔amber
on a 30 s cadence.

### 8.3 Regression gate — one more case

Extend §6.8 / §7.3 with: **"loser 4002-terminal'd, winner stays healthy for
≥ 3 alarm intervals."** Assert the terminal'd life does **not** re-challenge while
`/api/state` reports a live relay (zero additional `relay_superseded`/`replaced`
on the bridge), and that it **does** reconnect within one alarm interval once the
winner's socket is closed. This is the case that distinguishes "time-scoped,
guarded" from "unconditional retry / slow ping-pong."

### 8.4 Final implement-list (supersedes §7.3)

§6.7 + the four §7.1 backend corrections + the three §7.2 UI/observability
additions, **with §7.1.3 amended per §8.2 (guard the alarm retry on bridge-truth
liveness, not local `relay===null`)**, plus the §8.3 regression case. With this,
the design is deterministic under MV3 timing, storage atomicity, **and** the
two-long-lived-lives recovery path — no remaining re-admission of the storm.

---

## 9. Sixth-pass — AGREE (full-stack + ui-ux, 2026-06-25)

**AGREE.** §8 correctly closes the last gap I left in §7.1.3: an *unconditional*
alarm retry re-mints a higher `(Date.now(), lifeUuid)` and supersedes the healthy
winner → a 30 s-cadence slow storm. Gating the alarm re-challenge on bridge-truth
liveness (§8.2), reusing the §7.2.3 signal, is the right fix and adds no new
surface. I re-checked the full converged design end-to-end and find **no remaining
correctness hole**:

- **Same-gen concurrency:** strict `(gen, lifeUuid)` total order with exact-tie
  idempotent (§7.1.1) → single deterministic winner; the loser's 4002 is terminal.
- **Storage/rollback:** in-memory `(Date.now(), lifeUuid)`, nothing persisted
  (§7.1.2) → no RMW race, no counter-rollback lockout.
- **Dead window + slow storm:** time-scoped terminal, alarm re-challenge gated on
  bridge `/api/state` liveness (§7.1.3 as amended by §8.2) → recovers without ever
  re-challenging a live winner.
- **Backoff amplifier, Web Lock, truthful UI:** §6.1 / §6.5 / §7.2 all consistent
  and load-bearing only where intended.

**Two bounded residuals — accepted, non-blocking, must be TESTED not just asserted:**
1. **Recovery latency.** After the winner dies, a guarded terminal'd life only
   re-challenges once `/api/state` liveness shows the winner gone — and `liveness`
   lags by the bridge's staleness threshold (~45 s) plus the ~30 s alarm. Worst
   case "winner dies → tools restored" ≈ liveness-lag + one alarm interval, with
   MV3 SW cycling as a second, often-faster recovery path (a fresh life is not
   terminal'd). Acceptable; **assert the bound** in the §8.3 case rather than
   leaving it implicit.
2. **Backward wall-clock.** In-memory `Date.now()` can still mis-order across a
   large NTP/manual backward jump; the bridge liveness sweep reaps the stale
   high-identity incumbent within ~45 s and the lower-identity live client then
   wins. Strictly narrower than the counter's race+rollback (per §7.1.2) and
   self-healing — accept, with a note in the test plan.

**Status: CONVERGED — design agreed, ready to implement** per the §8.4 list. No
further review pass needed; remaining work is implementation + the regression gate
(§6.8 / §7.3 / §8.3 + the §9 latency-bound assertion), not more design.

---

## 10. CONVERGED — agreed (principal-engineer, 2026-06-25)

**AGREE — design is converged; closing the review loop.** §9's two residuals are
correct, bounded, and non-blocking, and both are direct consequences of the §8.2
guard rather than new holes:

- **Recovery latency** is the deliberate price of gating the alarm re-challenge on
  bridge-truth liveness (we removed a 30 s slow-storm in exchange for a bounded
  "winner-dies → tools-restored" ≈ liveness-lag (~45 s) + one alarm interval, with
  MV3 SW cycling as a usually-faster parallel recovery). It must be an **asserted
  bound** in the §8.3 case, not an assumption.
- **Backward wall-clock** mis-order on a large NTP/manual jump is strictly narrower
  than the counter's race+rollback (§7.1.2) and is reaped by the ~45 s bridge
  liveness sweep → self-healing. Accept with a test-plan note.

No outstanding correctness gap across same-gen concurrency, storage/rollback, the
dead-window/slow-storm path, the backoff amplifier, the Web Lock, or the truthful
UI. **Final authority = §8.4 implement-list + §9's two test assertions.** Remaining
work is implementation and the regression gate only — no further design pass.

---

## 11. Post-implementation review — three findings on the verdict/observability surface (principal-engineer, 2026-06-25)

**Scope.** This pass reviews the *implementation* of the converged design (the
23-file impl commit) against §1–§10, as a principal engineer, hunting for **new**
bugs the implementation could introduce — not re-litigating the design.

**Headline verdict: the core mechanism is correct.** The `(gen, lifeUuid)` total
order, the exact-tie idempotent accept (§7.1.1), the in-memory non-persisted
identity (§7.1.2), the scoped-terminal 4002 with the bridge-truth-guarded alarm
re-challenge (§7.1.3 + §8.2), and the backoff de-amplifier (§6.1) all landed as
specified. The convergence trace holds: the loser is terminated, sees close
`1006`, reconnects once with the SAME identity, re-challenges, is sent `4002`,
and treats it as terminal — converging in 1–2 cycles with no both-terminal
deadlock and an order-independent equal-gen tiebreak. **No new connectivity bug.**

The three findings below are all on the **truthful-UI / observability** surface
(§4 / §7.2) — i.e. the verdict could *lie* after a storm even though connectivity
itself is healed. Findings #1, #2, #4 are fixed in this commit; #3 is deferred
(rationale below).

### 11.1 Finding #1 (MEDIUM, fixed) — Flapping bound to a *cumulative* count never self-heals

The side-panel verdict bound the **Flapping** state ("Connection keeps dropping —
tools aren’t working") to the bridge's **cumulative** `supersededCount >= 3`,
evaluated *before* the Working gate. But the bridge only reset that counter on a
clean `1000` close; every MV3 eviction is `1006`/`1011`. So once a storm
converged (or after ≥3 lifetime SW-overlap supersedes across the bridge's whole
life) the panel showed "keeps dropping" **permanently** while tools worked fine.
This directly contradicts §7.2.2, which specified a replace-**RATE**, not a
lifetime total.

**Fix — bind Flapping to a rolling-window RATE that decays to zero.**
- Bridge (`service.ts`): added `browserSupersedeTimes: Map<string, number[]>`
  with a `SUPERSEDE_WINDOW_MS = 60_000` window; `bumpSupersededCount()` now also
  records a timestamp and prunes out-of-window entries. New
  `supersededRecentCount(browserId)` returns the in-window count. The cumulative
  `supersededCount` is **kept** (it is a useful lifetime diagnostic scar) but is
  no longer the verdict trigger. `/api/state.browsers[]` now emits BOTH
  `supersededCount` (cumulative) and `supersededRecentCount` (rate).
- UI (`connection-verdict.ts`): the Flapping check and the Working gate now read
  `api.supersededRecentCount` instead of `supersededCount`. Once the supersedes
  stop, the window empties within 60 s and the verdict self-heals to "working".

A real storm runs at ~1.3 s cadence (~46/min), so a 60 s-window threshold of 3
cannot false-positive on occasional benign SW cycling, yet trips immediately in a
true storm.

### 11.2 Finding #2 (LOW–MED, fixed) — exact-tie idempotent accept still polluted the churn signal

The bridge's collision rule already classified an exact `(gen, lifeUuid)` tie as
an **idempotent** same-life reconnect (§7.1.1) and did *not* send `4002`. But the
accept path still routed through `indexBrowser`, which **bumped**
`supersededCount`, logged `bridge.browser.replaced` at **warn**, and rejected
in-flight requests — despite the inline comment saying "NOT counted as churn." A
single SW reopening its own socket after a transport blip therefore inflated the
very Flapping signal #1 depends on.

**Fix.** `indexBrowser(browserId, ws, idempotent = false)` now takes an
`idempotent` flag; the exact-tie branch calls `accept(true)`, which threads the
flag through so the idempotent path **skips** the supersede bump and the scary
`replaced` warn. It still terminates the orphaned socket and fails its in-flight
requests (that socket is genuinely gone and the new life never saw those
requests) — correctness unchanged, signal no longer polluted.

### 11.3 Finding #3 (LOW, deferred) — `recordRelayClose(4002)` on lower-identity rejection mislabels a healthy browser

When a strictly-lower challenger is rejected, the bridge stamps the *incumbent's*
`lastRelayClose = 4002`. That mislabels a perfectly healthy winner's last-close
code. **No false verdict today** — nothing in the converged UI keys off
`lastRelayCloseCode` for the Flapping/Working decision — so this is recorded as a
latent observability wart, not fixed in this commit, to keep the change surface
minimal and the diff easy to review. If a future diagnostic starts trusting
`lastRelayCloseCode`, fix it then (stamp the *rejected challenger's* close, not
the incumbent's).

### 11.4 Finding #4 (GAP, fixed) — the highest-risk new extension code had no direct unit test

`connection-manager.ts` — which owns relay-identity minting, `withRelayRole`
stamping, the 4002-terminal handling, `probeBridgeRelayLiveness`, and the guarded
recovery in `reconcile()` — had **zero** direct unit tests; only the real-bridge
chaos spec exercised the guard externally. Added `connection-manager.test.ts`
(mocks `./relay-client` to capture callbacks + connect URLs, mocks
`getBrowserInstanceId`, stubs `fetch` for the liveness probe, injects
`discoverUrl`, uses fake timers) covering:
- connect URL carries `role=relay` + `gen` + `lifeUuid`;
- a `4002` close → `awaiting_sw_recovery` and schedules **no** reconnect even
  after advancing timers (the terminal-but-scoped invariant);
- a non-4002 `1006` close is **not** treated as terminal supersede;
- `reconcile()` **defers** (no re-challenge) when `/api/state` shows our relay
  `live` *or* `unknown` (fresh winner, no inbound frame yet);
- `reconcile()` **mints a fresh identity** (new `lifeUuid` in the next connect
  URL) and reconnects when `/api/state` shows no relay *or* a `stale` one.

Also extended `service.test.ts`: an exact-tie idempotent reconnect does **not**
bump `supersededRecentCount`, a real strictly-higher supersede **does**, and
`pruneSupersedeTimes` decays the window to zero (the boundary at exactly
`now − 60 s` is inclusive). And `connection-verdict.test.ts`: a high **cumulative**
`supersededCount` with a **flat** `supersededRecentCount` + a recent success now
asserts **working** — the explicit regression for #1's "post-convergence lie".

### 11.5 Net

Three observability/verdict fixes, no change to the converged connectivity
mechanism. The cumulative `supersededCount` is retained for diagnostics; the
verdict now binds to the decaying **rate** so it tells the truth both *during* a
storm and *after* it converges. Full suite green: native-host **200**, extension
**311**, both type-clean under their real build tooling (`tsc` / `wxt build`).
Native-host changes are source-only; the compiled binary recompile + GitHub
release remain a release-tag step, not part of this review iteration.

**For the reviewing agent:** the load-bearing judgement to check is the
**60 s / threshold-3** choice in §11.1 (does it trip fast enough in a real storm
yet never false-positive on benign SW cycling?), and whether keeping cumulative
`supersededCount` purely as a diagnostic — with the verdict bound only to the
rate — is the right split.

