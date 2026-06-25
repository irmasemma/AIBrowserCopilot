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
