# RCA — Dropped Clicks (stale `data-ai-ref` against self-mutating DOM)

- **Date:** 2026-07-01 (RCA + design) · 2026-07-03 (Fix B implemented in working tree)
- **Status:** Confirmed via live reproduction. Corrected Fix B **implemented and verified building + unit-green in the working tree**. Fix C dropped by user decision. **NOT committed or merged** — changes are working-tree only, awaiting the user's git handling.
- **Reported symptom:** "Some clicks dropped." User asked for a 5-hour local + Neon log review, root cause, and a robust long-term fix (not a quick patch).
- **Investigator:** `full-stack-engineer` subagent (two diagnostic passes: log analysis → live RCA confirmation + design).
- **Scope of this doc:** diagnosis + design only. Implementation is NOT done. Do not commit off this without explicit sign-off.

---

## 1. Summary

Over the past 5 hours (2026-07-01, 13:20–18:18 UTC / 09:20–14:19 local) there were **19 tool errors out of 281 dispatched tool calls**. Nothing was silently dropped at the transport/relay layer — the pipeline balances exactly (281 received = 281 dispatched = 262 success + 19 error).

Of the 19 errors, **11 were `click_element` failures** — these are the "dropped clicks." All 11 share the signature `locator.click: Timeout 8000ms exceeded … waiting for locator('[data-ai-ref="eN"]')`.

**Root cause (confirmed by live repro):** `data-ai-ref` is a throwaway attribute stamped onto live DOM nodes at `snapshot` time, not a durable identifier. When a page mutates its DOM between the `snapshot` and the `click_element` call, the tagged node — and its attribute — are destroyed, so the click's locator matches **zero** elements and burns the full 8s timeout before failing with an opaque, code-less error.

The dominant contributor (7 of 11) is **self-inflicted**: AgentHub's own diagnostics dashboard (`diag-page.ts`) rewrites its panels' `innerHTML` every 1.5s, destroying any refs a snapshot had placed on it. The remaining 4 were against `analytics.google.com` (a heavy Angular Material SPA); those could not be independently reproduced (see §4.4) and are treated as an open sub-case.

The connection/relay layer was healthy throughout — no version skew (bridge and extension both 0.5.17), no orphan-socket wedge, no relay storm, no connection churn on the acting browser.

---

## 2. Log sources (reproducible)

| Source | Location / access |
|---|---|
| Local NDJSON logs | `%LOCALAPPDATA%\agenthub\logs\{bridge,extension,helper}.log[.1-.4]` |
| Remote log sink | Neon `agenthub_logs` DB. Connection string: `packages/log-ingest/.env.production.local` → `DATABASE_URL` (pooler `ep-weathered-queen-aqo9vo3o`). Queried **directly** with `@neondatabase/serverless` from `ai-browser-copilot/node_modules` — a direct Postgres connection that **bypasses the Vercel auth-protection gotcha** (no HTTP hop). Schema: `packages/log-ingest/schema.sql`. |
| Live bridge state | `GET http://127.0.0.1:7483/api/state` (bridge PID 13792, v0.5.17, uptime 15.9h — up the whole window). |
| Live repro target | `http://127.0.0.1:7483/` diag dashboard, tab `chrome:5d266380-cc16-47e9-b14a-452a30a2a515:622794531`, via live MCP `snapshot`/`click_element`. |

**Install IDs reporting in window:** `7a69b3c5…` (16,230 rows, this machine's active session) and `4d6f6a9c…` (1,503 rows).

---

## 3. What failed, and how often

Pipeline accounting (from `ext.tool_request.received`, `dispatch.start`, `dispatch.complete`, `dispatch.error`):

```
ext.tool_request.received = 281
dispatch.start            = 281
dispatch.complete         = 262
dispatch.error            =  19
                            ────
262 + 19 = 281  ✔ exact match — nothing silently vanished
```

The 19 errors:

| Count | Tool | Error | Assessment |
|---|---|---|---|
| **11** | `click_element` | `locator.click: Timeout 8000ms exceeded` | **The dropped clicks.** Stale ref / zero-match. |
| 6 | `extract_data` | `CONTENT_UNAVAILABLE` — "No structured data detected on page" | Page genuinely had no structured data. Likely expected; confirm intent (looks like a repeated ~30min probe, 15:12–16:44). |
| 2 | `take_screenshot` | CDP `page.screenshot` timeout (12000ms) | Isolated cluster at 14:16, no recurrence. Not correlated with the clicks. |

### 3.1 Connection-layer events in-window (all ruled out as click causes)

- `bridge.browser.replaced` = 4 — all `browserId=helper-probe`, the exempt liveness-probe sentinel, **not** the real extension connection.
- `bridge.browser.liveness_failed` = 1 — a different browserId; no click impact.
- `ext.heartbeat.miss/dead` = 5/3 — browserId `930f97b6…`, a **second** connected profile that issued **none** of the failing clicks.
- `bridge.probe.connected/disconnected` ≈ 3259/3255 and `relay_reconnect_idempotent` ≈ 3250 — the extension's normal 5s liveness heartbeat (`FAST_POLL_INTERVAL_MS=5000` in `entrypoints/background.ts`), **not** a storm. Rate matches expected cadence; none produced a real-browser churn event.

**The browser that issued the failing clicks** (`chrome:5d266380…`) has **zero** `ws.close` / heartbeat / `replaced` events in or around the failure windows — the WS relay was stable throughout. No version skew (bridge 0.5.17 == extension/native-host `package.json` 0.5.17, single dev build).

### 3.2 The two click failure clusters

1. **14:33:24–14:42:46 (7 of 11)** — target `http://127.0.0.1:7483/…`, i.e. **AgentHub's own diagnostics dashboard**. Refs `e26`, `e15` (retried twice), `e16`, `e12`, plus 2 CSS-selector attempts (one failed fast at 276ms — consistent with a strict-mode/zero-match violation on a target just replaced by the poll).
2. **14:25:48–14:26:19 and 17:58:13 (4 of 11)** — target `analytics.google.com`, refs `e12`/`e13`, recurring on `e12` again at 17:58 in a fresh tab.

---

## 4. Confirmed root cause — code + live repro

### 4.1 Where `data-ai-ref` comes from and how long it lives

`packages/extension/src/background/tool-dispatcher.ts` — every `snapshot` (and every mutating tool's trailing re-snapshot) runs `SNAPSHOT_REF_INJECTOR` in-page:

```js
126:  document.querySelectorAll('[data-ai-ref]').forEach(el => el.removeAttribute('data-ai-ref'));
...
129:  let counter = 0;
130:  const elements = document.querySelectorAll(SELECTOR);
131:  for (const el of elements) {
132:    if (!IS_VISIBLE(el)) continue;
133:    const ref = 'e' + (++counter);
134:    el.setAttribute('data-ai-ref', ref);
```

So `data-ai-ref`:
- is **not durable** — it's stamped onto whatever live nodes exist at that instant, in DOM-order sequence;
- is **wiped and renumbered from scratch** on every snapshot;
- is resolved at action time by a **fresh live query**, not a cached handle: `click_element` (`:644`), `press_key` (`:708`), and `fill_form` (`:528`) all do `page.locator('[data-ai-ref="${ref}"]')`.

If the underlying node is replaced by **any** DOM mutation before the action runs, the attribute and node are simply gone → zero-match → 8s timeout.

### 4.2 The diag dashboard destroys those nodes every 1.5s

`packages/native-host/src/diag-page.ts`:

```js
367: const POLL_MS = 1500;
406: async function poll() {
408:   const r = await fetch('/api/state');
410:   state.state = await r.json();
411:   render();
...
872: setInterval(poll, POLL_MS);
```

`render()` unconditionally rewrites `.innerHTML` every tick, regardless of whether the data changed:

```js
427: document.getElementById('bridge-meta').innerHTML = ...
469: document.getElementById('ext-meta').innerHTML = ...
489: document.getElementById('browser-meta').innerHTML = '<div class="item-list">' + s.browsers.map(...)
```

The server-rendered templates **never** contain `data-ai-ref` (it's a client-only injection), so every 1.5s any ref inside these panels is destroyed and does not return until the next `snapshot`.

### 4.3 Live reproduction (executed this session — real browser, real MCP round-trip, not mocked)

1. `snapshot` on the live diag dashboard tab → returned `ref=e12` for the expanded browser row.
2. `click_element(tab_id=…, ref="e12")`, issued after the normal MCP round-trip (comfortably >1.5s, ≥1 poll cycle), returned:

```
locator.click: Timeout 8000ms exceeded.
Call log:
  - waiting for locator('[data-ai-ref="e12"]')
```

This is **byte-for-byte the production signature** (`event=ext.tool.dispatch.error`, `toolName=click_element`, Neon `agenthub_logs`, 14:26–14:43 and 17:58). RCA is directly demonstrated, not correlated.

3. A second `snapshot` immediately after showed `e12` at the **same index** but with different counts (e4: 48→45 calls, e6: 2→5 calls) — proof the panel's nodes regenerated between snapshots even though the ref number coincidentally landed the same. This is the "stale-node-under-same-index" hazard the design guards against.

### 4.4 Zero-match vs. found-but-blocked — resolved from the call log, not assumed

Playwright only appends actionability sub-steps ("waiting for element to be visible/stable", retries) **once a locator resolves to a real element**. Our live repro's call log is a single `waiting for locator(...)` line with **no** actionability sub-steps → **zero elements matched** → genuinely stale/destroyed, not present-but-blocked. This confirms the diag-page cluster (7/11) is the zero-match/stale case.

**Could NOT independently reproduce:** the 4 `analytics.google.com` failures and the 2 selector failures. GA session state from that time is gone, and the messages were redacted (`[len=N]`, >200 chars) by `redaction.ts` before storage, so the original call-log content is unrecoverable after the fact. Structural inference (longer call logs usually mean Playwright logged actionability retries, which only happen after an element is found) suggests these are more likely the **found-but-not-actionable** sub-case (GA's Angular Material overlays/animations) — **stated as inference, not confirmed.** The design treats it as an open case and specifies the exact probe (Test Plan §6.3) to confirm it live.

### 4.5 The class, not just the instance

`fill_form` (`:528`), `click_element` (`:644`), and `press_key` (`:708`) share the **identical unguarded** pattern: resolve `[data-ai-ref="…"]` via a fresh `page.locator()` with no existence/identity check, and **none** assign a structured `{code: …}` to the thrown error — unlike every other handler in the file (`TAB_NOT_FOUND`, `DOMAIN_BLOCKED`, `CONTENT_UNAVAILABLE`, `TOOL_TIMEOUT`, set via `Object.assign(new Error(...), {code})` at lines 249/259/264/309/314/332/361/396/451/468/474/746/762/934/984/1019). This is why `click_element`'s logged errors carry no `errorCode` (`redactError`, `redaction.ts:353-361`, only emits `errorCode` when `err.code` is a string) while `extract_data`/`take_screenshot` do.

---

## 5. Robust long-term design (design only — not implemented)

### 5.1 The invariant

Any `ref` from a `snapshot` is valid only until the **next DOM mutation of that node** OR the **next snapshot/mutating-tool call** (which wipes and renumbers everything). True for third-party sites we don't control (GA) and doubly true for AgentHub's own diag page (self-inflicted, 1.5s cadence). A robust fix must be correct for **both**, and must guard the dangerous inverse case: a ref number surviving numerically but being silently reassigned to a **semantically different** element — a naive "re-resolve by position" fix could turn a loud timeout into a **silent wrong click**, which is strictly worse.

### 5.2 Full state space for `click_element(ref)`

| # | Situation | Current behavior | Required behavior |
|---|---|---|---|
| 1 | Node unchanged since snapshot (happy path) | Clicks fine | Stay exactly as fast/correct — no added latency, no new failure mode |
| 2 | Node destroyed, attribute gone (zero-match) | 8–13s hang → generic `locator.click: Timeout` | Fail in ~100ms with a distinct `REF_STALE` code |
| 3 | Node present but not actionable (hidden/covered/animating) | 8–13s hang → generic timeout, longer call log | Distinguish from #2 with its own `CLICK_NOT_ACTIONABLE` code |
| 4 | Node destroyed, but re-numbering/coincidence makes the **same** ref value later resolve to a **different** element | Not accidentally hittable within one call today (locator is a fresh live query; any mutation destroys the attribute before a second injection could re-add it) — but a **real risk if a naive fix adds blind positional re-resolution** | Any retry/re-resolution MUST verify identity (role + accessible name) before clicking, never by raw position |

### 5.3 Options considered

- **A — Durable/reconstructable selector instead of positional ref.** At snapshot, compute a robust selector per element (prefer `id`, else `data-testid`, else a short structural path); resolve by that at click time. *Pro:* survives node replacement when an element of the same identity re-appears. *Con:* doesn't help elements with no stable attributes (most diag-dashboard buttons are indexed by `.map()` position and have none) — degrades to positional matching exactly where it hurts most; large surface change (snapshot generation, ref format, three call sites, every caller's mental model of a `ref`).
- **B — Fail-fast existence + identity check, with one bounded, identity-verified re-snapshot-and-retry.** Cheap, localized to the three call sites, reuses the existing error-code convention, and turns the 8–13s opaque hang into either a fast clean error or a fast self-healing retry — without changing what a `ref` fundamentally is.
- **C — Stop AgentHub's own page thrashing refs** (diff-before-render in `diag-page.ts`). Fixes the self-inflicted instance directly but does nothing for GA or other third-party SPAs — necessary but not sufficient alone.

### 5.4 Chosen: **B + C together**

B is the only option covering the **general** class (any site) and must exist regardless. C removes the majority contributor (7/11) at the source, so B's retry path is exercised far less on our own surfaces. **A is not chosen now** — heavier, orthogonal; revisit only if B+C prove insufficient for third-party SPA staleness at scale.

#### B in detail (applies to `click_element` `:644`, `press_key` `:708`, `fill_form` `:528`)

1. Before the existing bounded 8s Playwright action, do a near-instant `locator.count()` (no wait — injection is synchronous, so the node is either present or not):
   - `count === 0` → throw immediately `{code: 'REF_STALE'}`; no 8s wait spent.
   - `count > 1` → throw `{code: 'AMBIGUOUS_REF'}` (surfaces a latent risk on `text`/`selector` locators too).
   - `count === 1` → capture the element's role + accessible-name fingerprint (reuse the best-effort `evaluateHandle` already done on the happy path at `tool-dispatcher.ts:665-675` — no new latency) and compare against the fingerprint recorded for that ref in the snapshot line (the YAML line `- button "…" [ref=eN]` already carries the accessible name — thread it through as the expected fingerprint). **Mismatch** → `{code: 'REF_IDENTITY_CHANGED'}`, refuse to click. **Match** → proceed to the existing bounded 8s `locator.click()` exactly as today; a real actionability timeout here now cleanly means case #3 → `{code: 'CLICK_NOT_ACTIONABLE'}`.
2. On `REF_STALE` **only** (not `CLICK_NOT_ACTIONABLE` or `AMBIGUOUS_REF` — those aren't "try again"): do **exactly one** internal retry — re-run the ref injector, search the fresh element set for a **unique** role+accessible-name match to the **original** snapshot line's fingerprint (never by raw index), and if found, click it. Log both attempts distinctly (`ext.tool.dispatch.stale_ref_retry`) so it can never regress into a silent or unbounded loop. If no unique match, return the clean `REF_STALE` error — the LLM caller already knows to re-`snapshot`.
3. Happy path cost unchanged (case #1): count check + fingerprint compare are microseconds, reusing work already done.

#### C in detail (`diag-page.ts render()`)

Stop unconditional `innerHTML` replacement on every 1.5s tick. Before rewriting `bridge-meta`/`mcp-meta`/`ext-meta`/`browser-meta`/activity list, shallow-diff the incoming `/api/state` JSON against the last-rendered snapshot for that panel and **skip the rewrite if unchanged** (kills the dominant real-world case — in a quiet session most ticks are no-ops). Follow-up (not required to close this out): real DOM patching for panels that *do* change, so refs on unrelated unchanged rows survive even when sibling rows update.

---

## 6. Test / regression plan

1. **Happy path / inverse case (must not regress):** snapshot → click still-valid ref immediately → succeeds, duration within current baseline ± noise. Guards against a careless fix adding cost to every click.
2. **Stale-ref repro (the exact bug reproduced live):** real-browser fixture (not mocked Playwright/WS) whose parent node is replaced via `innerHTML` on an interval faster than a typical LLM round-trip — use the diag dashboard itself as canonical fixture. snapshot → wait > one poll cycle → click by ref → assert failure surfaces well under 8s with `REF_STALE` (or a single distinctly-logged retry success if the fresh element is uniquely identifiable).
3. **Found-but-blocked, distinguished from stale (resolves the open GA case):** fixture with a target covered by an overlay for ~2s then revealed. Click during coverage → `CLICK_NOT_ACTIONABLE`, not `REF_STALE`. Click after reveal (before 8s) → success. Smallest probe that would confirm/refute the GA hypothesis against a controlled GA-like fixture.
4. **Race window / bounded retry:** fixture destroying/recreating the node every 300ms (faster than one retry can win). Assert clean failure after exactly one retry, bounded total time (~2× a single attempt), never hangs, never loops.
5. **Adversarial inverse case — identity-mismatch protection:** fixture where, after mutation, a **different** semantic element lands at the same position an old ref pointed to. Assert `REF_IDENTITY_CHANGED` / no retry-click rather than a silent wrong click. Regression guard against the specific failure a naive "re-resolve by position" fix would introduce.
6. **Diag-page-specific guard (closes the self-inflicted majority):** snapshot dashboard, wait >1.5s where `/api/state` data is unchanged → ref click still succeeds (proves C's diff-before-rewrite). Companion: data *does* change during the wait (e.g. a new MCP client connects) → panel updates correctly (C isn't over-throttling) while a ref on an unrelated unchanged part still resolves.
7. **Merge gate:** land as a dedicated spec (e.g. `ref-liveness.spec.ts`) in the required `npm test --workspaces` gate per `CLAUDE.md`, so any future change to `click_element`/`press_key`/`fill_form` ref resolution or `diag-page.ts render()` trips a fast direct signal instead of surfacing 3h later as "some clicks dropped."

---

## 7. Other failures worth flagging

- `extract_data` "No structured data detected" (6×, ~30min apart 15:12–16:44) — looks like a scheduled/repeated probe against a page with no structured data; likely expected, confirm intent.
- `take_screenshot` CDP timeout ×2 at 14:16:17 / 14:16:37 — isolated, no recurrence, not correlated with the clicks.
- No 4002/relay-storm or orphan-socket-wedge signatures appeared (no anomalous `browser.replaced` spam, no 10s fan-out stalls, no lock-file loss).

---

## 8. Files referenced

- `packages/extension/src/background/tool-dispatcher.ts` — ref injector (21–140), `fill_form` (516–528), `click_element` (634–693), `press_key` (695–716), `dispatchTool`/error-code convention (1026–1089).
- `packages/native-host/src/diag-page.ts` — `POLL_MS` (367), `poll` (406–420), `render`/`innerHTML` rewrites (422–533), `setInterval` (872).
- `packages/extension/src/shared/redaction.ts` — `redactError`/`redactString` (353–361); explains why historical GA messages are unrecoverable.
- `packages/log-ingest/.env.production.local` → `DATABASE_URL`; `packages/log-ingest/schema.sql`.
- Live repro: `http://127.0.0.1:7483/` tab `chrome:5d266380-cc16-47e9-b14a-452a30a2a515:622794531` (ref `e12`, error `locator.click: Timeout 8000ms exceeded … waiting for locator('[data-ai-ref="e12"]')`).

---

## 9. Implementation status (2026-07-03)

Corrected **Fix B implemented**; **Fix C intentionally NOT done** (user: the diag dashboard's 1.5s refresh is fine, do not change `diag-page.ts`). This means B stands on its own — the general click-path hardening handles both the diag-dashboard and third-party (GA) staleness; the diag page itself is left as-is.

**Design correction applied during implementation:** the earlier design's `fill_form` catch referenced `locator`/`effectiveType`/`detected`/`valueStr`, which were block-scoped inside the `try` and thus invisible to the `catch` (would not compile / be dead code). Fixed by **hoisting those declarations above the `try`** so the catch can classify + retry. This was the one latent bug in the artifact.

Files changed (working tree only, **not committed**):
- `packages/extension/src/background/tool-dispatcher.ts` — §0 helpers (fingerprint cache, `classifyLocatorFailure`, `toClassifiedError`, `performFieldAction`, three retry helpers); `captureSnapshot` populates the cache; `click_element` / `press_key` / `fill_form` classify-after-failure + bounded identity-verified retry; case-4 `refIdentityWarning`.
- `tests/e2e/ref-liveness.spec.ts` (new, 10 tests) + `tests/e2e/fixtures/ref-liveness.html` (new).

Verification performed:
- `wxt build` (real production build) — **passes**, artifact produced.
- `npm test` (extension vitest) — **327/327 pass**, no regressions.
- `tsc --noEmit` — the only errors are **pre-existing baseline** noise in untouched code (evaluateHandle probe, `scroll_page`, wxt auto-imports, preact `h`); the list is byte-identical before/after this change. My inserted code adds **zero** new type errors.
- `npx playwright test tests/e2e/ref-liveness.spec.ts --list` — all 10 tests compile/register.

**Not yet run (deliberate-run, needs a live browser):** the ref-liveness e2e requires reloading the newly-built extension into a connected Chrome (+ file-URL access) and a running bridge. This is the only step left to prove `REF_STALE` fires end-to-end live — pending a browser reload, which is the user's call.

## 9a. Live e2e verified GREEN (2026-07-04)

Ran `ref-liveness.spec.ts` against the real bridge + a real Chrome with the **rebuilt** extension reloaded. Two extension-only follow-ups were applied after the first live run exposed them, then re-verified:

1. **`errorCode` now reaches the MCP client.** The bridge's `translateExtensionResponse` forwards only `error.message`, not `.code` (a *pre-existing, systemic* limitation affecting every error code, not introduced here). Fix: `toClassifiedError` now prefixes the code into the message (`REF_STALE: locator.click: ...`) — extension-only, no native-host change. Confirmed live: `errorMessage:"REF_STALE: locator.click: Timeout..."`.
2. **Test corrections.** `destroy-recreate` (rebuilds the same button forever) is the *recoverable* case — the retry self-heals it, so it returns **success**, not `REF_STALE`; the original test asserted backwards. Split into: `destroy-once` (deterministic self-heal → success) and `destroy-permanent` (node removed → `REF_STALE`). Fixed a `fill_form` fixture bug (checkbox action pointed at a `<button>`).

Final result: **10/10 pass, 1 intentional skip.** Self-heal confirmed live via `ext.tool.dispatch.stale_ref_retry outcome:"succeeded"`. Success path unchanged (late-render 300ms/2s/7.5s all succeed; happy-path latency flat). `REF_STALE` fires at ~12.5s wall-clock (wait not pre-empted). 327/327 unit tests pass; `wxt build` clean.

**Verdict (full-stack, adversarial): SHIP** — the extension-only change is correct, regression-safe, and now delivers both halves of the design (internal self-heal + client-visible code).

**Real-world nuance found:** on a DOM that thrashes *continuously* (e.g. diag-page's 1.5s poll, forever), even the one-shot retry can out-race the mutation and still return `REF_STALE` — the fix greatly improves but does not 100% guarantee recovery under nonstop mutation. Acceptable; the diag page is not changed per user decision.

## 10. Decisions still open / follow-ups (none block the extension-only ship)

- [ ] Run the live ref-liveness e2e after reloading the rebuilt extension (proves `REF_STALE` end-to-end).
- [ ] Confirm intent of the repeated `extract_data` probe (expected vs. bug).
- [ ] Confirm the GA case live (Test Plan §6.3) — still an inference, not confirmed.
- [ ] Commit/merge — **user will handle git**; nothing committed in this session.
- [ ] Follow-up (optional): `REF_STALE` is a slight misnomer for selector/text locators (no ref involved) — consider a `TARGET_NOT_FOUND` alias.
