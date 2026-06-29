# RCA — Relay-supersede storm recurrence (`browser_socket_replaced_mid_request`)

**Date:** 2026-06-28 (events in logs are UTC, ~2026-06-29T02:41–03:12Z)
**Severity:** High — every MCP tool call fails; browser cannot be driven.
**Status:** Root cause confirmed. **No fix applied** (investigation only, per request).
**Relates to:** `docs/design-2026-06-25-relay-storm-fix-expert-review.md` (the fix design),
`docs/rca-2026-06-18-green-but-zero-tabs.md` (same "green lies" class).

## Symptom

Both Chrome profiles return `browser_socket_replaced_mid_request` on every tool
call, while the side panel shows a confident **Connected** (port listening,
protocol, heartbeat on time). The assistant cannot drive the browser.

## Verdict

This is the **known relay-supersede storm** — but it is recurring for a new
reason: a **half-applied upgrade**. The `(gen, lifeUuid)` total-order fix designed
and implemented on 2026-06-25 (see the design doc, §1–§11) **is live in the loaded
extension but NOT in the running bridge binary.** Because the storm fix is
*bridge-authoritative* (the bridge must reject losers with `4002` for the
extension's terminal-close logic to fire), the extension-side half is **inert**,
and the original v0.5.14 storm runs unchecked.

## Root cause — version skew (extension v0.5.16 ↔ bridge v0.5.14)

| Component | Version | State | Evidence |
|---|---|---|---|
| **Loaded extension** | **0.5.16** | Fixed — sends `?role=relay&gen=…&lifeUuid=…`, treats `4002` as terminal | `dist/chrome-mv3/manifest.json` version 0.5.16; `background.js` (built 2026-06-25 16:26) contains `gen=`, `lifeUuid`, `role=relay` |
| **Running bridge** | **0.5.14** | Pre-fix — ignores `gen`/`lifeUuid`, "newest socket wins", closes losers `1006` (never `4002`) | `server.lock` `version:"0.5.14"`, pid 41796, `startedBy:"autostart"`; bridge.log emits `relay_superseded reason:"newer_canonical_relay"` + `replaced reason:"new_socket_for_same_browserid"` with **zero** `gen`/`lifeUuid` anywhere |
| **Installed bridge binary** | 0.5.14-era | Never updated | `%LOCALAPPDATA%/agenthub/agenthub-win-x64.exe` mtime **2026-06-19 13:19** (v0.5.14 released 06-19); autostart launches this file |
| **Released binaries** | 0.5.15, 0.5.16 | Exist, never installed locally | `gh release list agenthub-releases`: v0.5.16 (2026-06-25), v0.5.15 (2026-06-23) |
| **Source tree** | 0.5.16 | Has the fix | `service.ts` has 15 `gen`/`lifeUuid` references |

The release pipeline did its job (v0.5.16 binary is published). What was missed:
the **local install was never upgraded** to it (no `npx agenthub-setup --update`
run; autostart still points at the 2026-06-19 binary). Meanwhile the unpacked dev
extension *was* rebuilt to 0.5.16 on 06-25 — creating the skew.

### Why the fix is inert against a v0.5.14 bridge

The convergence in the design depends on the bridge enforcing the total order and
**rejecting the strict loser with `4002`**, which the extension treats as terminal
(no reconnect) — that is what stops the ping-pong in one cycle. With a v0.5.14
bridge:

1. Extension SW life A connects (`role=relay&gen&lifeUuid`). Bridge ignores the
   params, accepts.
2. Extension SW life B connects. v0.5.14 rule = "newer canonical relay wins
   unconditionally" → supersede A, terminate A's socket with close **`1006`**
   (not `4002`).
3. Extension's `connection-manager` sees `1006` → **not terminal** →
   `scheduleBackoff` → A reconnects → re-challenges → supersedes B → …
4. The `4002`-is-terminal branch in the v0.5.16 extension **never executes**
   because the old bridge never sends `4002`.

Two overlapping SW lives per profile, ×2 profiles, ping-pong indefinitely. Any
tool call in flight during a supersede is rejected with
`browser_socket_replaced_mid_request` (`service.ts:230`, in `indexBrowser`).

## Evidence — storm is live and bilateral

- **Active window:** `relay_superseded` first 2026-06-29T02:41:39Z → last
  03:10:39Z (~29 min continuous), local `bridge.log` written through 03:11Z.
- **Volume (current bridge.log):** 680 `relay_superseded`, 689 `browser.replaced`,
  681 `browser.connected`, 4 `browser_socket_replaced_mid_request` (the 4 = tool
  calls that happened to be in flight; most supersedes have no in-flight request).
- **Both profiles:** supersedes split `chrome:5d266380…` = 356,
  `chrome:930f97b6…` = 324. Matches the "both Chrome profiles" report.
- **Single bridge pid** (41796) listening on 7483; no zombie second bridge this
  time — consistent with design §6.1 ("two bridge processes is NOT a precondition;
  the cause is two SW lives + shared browserId").

## Remote logging to Neon — YES, posting correctly (verified directly)

`logs-config.json` has `remote.enabled:true` → endpoint
`https://log-ingest-irmas-projects-28aa1036.vercel.app/api/logs`. The sink is
fire-and-forget and logs nothing locally about its own success/failure, so this was
verified by querying Neon directly (`@neondatabase/serverless`, `DATABASE_URL` from
`packages/log-ingest/.env.production.local`):

- **TOTAL ROWS:** 465,022 (since 2026-06-18T19:59Z); **last 2h:** 8,348.
- **Latest `received_at`:** 2026-06-29T03:12:55Z (seconds before the query — live).
- **Storm captured in Neon (last 6h):** `bridge.browser.replaced` = 1289,
  `bridge.browser.relay_superseded` = 1262, last_ts 03:10:39Z — agrees with local
  logs.
- **Top pid last 6h:** 41796 (7,821 rows) = the running v0.5.14 bridge;
  pid `null` (527) = forwarded ext/helper records.

Conclusion: telemetry is intact; the entire storm is queryable in Neon by
`event`, `pid`, and `fields->>'browserId'`.

## Why the panel still says "Connected"

Same blind spot as the 2026-06-18 RCA: diagnostics bind to **bridge-side** liveness
(port/protocol/heartbeat). The bridge always has *a* live socket and an on-time
heartbeat — just a *different* one every couple of seconds. Green means "the bridge
is up," not "a socket survives a request." (The truthful-UI redesign that fixes
this is specified in the design doc §4/§7.2 but, like the bridge binary, is not
deployed here.)

## The fix (NOT applied — recorded for the follow-up)

Primary: **upgrade the installed bridge binary to the already-released v0.5.16** so
both halves of the `(gen, lifeUuid)` fix are present, then restart the bridge.
Mechanically: `npx agenthub-setup@latest --update --extension-id <id>` (pulls the
v0.5.16 binary from `agenthub-releases`), confirm `server.lock` shows `0.5.16`, and
verify the relay connect carries `gen`/`lifeUuid` and a strict loser receives
`4002`. Until then the loaded v0.5.16 extension cannot converge against the stale
bridge.

Process gap to address separately: an upgrade that rebuilds the extension but
leaves the autostarted bridge binary stale should be detectable — surface the
three-way version (extension / bridge / helper) skew in diagnostics (design doc
§4 "Version mismatch" state) so this fails loud instead of presenting as
"Connected."

## One-line summary

The relay-storm fix shipped to source and to GitHub releases and to the loaded
extension (v0.5.16), but the machine's autostarted **bridge binary is still the
2026-06-19 v0.5.14 build**; with the bridge half of the fix absent the extension's
`4002`-terminal logic is inert, so the original supersede storm recurs on both
profiles. Logs for it are present in Neon.
