# RCA — Playwright tool-path failures (v0.5.14, 2026-06-19)

All bugs below were diagnosed from **hard data** (`%LOCALAPPDATA%\agenthub\logs\`,
`ext.pw.timing` instrumentation, live MCP round-trips), not code inference. Each
fix is paired with a regression test — unit (`tool-dispatcher.test.ts`, runs in
CI) and/or real e2e (`tests/e2e/tool-path-real.spec.ts`, drives the genuine
`MCP → bridge → extension → playwright-crx → Chrome` chain).

---

## 1. `click_element` reported a timeout but the click had landed (~16–18 s)

**Symptom.** Clicking a link/button that navigates returned an *error* after
~16–18 s, even though the click had actually happened and the page had moved.

**Root cause.** After clicking, the handler **re-resolved the element** with an
*unbounded* `locator.evaluateHandle(...)` to report "what was clicked". A
navigating click detaches the element / destroys the JS context, so that
re-resolve hung until some upstream timeout fired — and the tool then reported
the *landed* click as a failure. Confirmed by step logging: `before_capture`
logged, `before_click` never did → the hang was the capture-before re-resolve,
not the click.

**Fix.** Never re-resolve a locator after a mutating action (refs are
render-scoped — invalidated by any DOM mutation). The click waits for any
post-click navigation but is **bounded to 8 s**; element info is read **once,
before** the click, behind a 1.5 s race; the fresh post-action snapshot is the
source of truth. Class-wide: same bounding applied to `press_key` and
`fill_form` (a keypress/submit can navigate too).

**Tests.** Unit: "NEVER re-resolves after clicking", "press_key bounded +
noWaitAfter". E2e: "navigating click lands FAST with success".

---

## 2. Empty snapshot after a navigating click

**Symptom.** The snapshot bundled into a navigating click's response was
sometimes empty — no interactive refs.

**Root cause.** The snapshot is captured immediately after the click. If the
click navigated, the destination's JS execution context is still being rebuilt,
so the ref-injector `page.evaluate` returns nothing (or throws "context
destroyed"). This is inherent to snapshotting a page that is still loading.

**Fix.** `captureSnapshot` does a bounded `waitForLoadState('domcontentloaded')`
before injecting (instant on a settled page). When refs are still unavailable,
`withSnapshot` now emits an **explicit "page is still loading — call
get_page_content / take_screenshot next step" note** instead of a silent empty.
The contract: **never emit stale pre-navigation refs** — empty-but-honest beats
wrong. The destination is always reachable on the next call (verified:
`get_page_content` returns the new page).

**Tests.** Unit: "real refs when present" + "explicit still-loading note, never
silent-empty". E2e: "navigating click returns an honest snapshot".

---

## 3. `take_screenshot` was slow — up to ~13 s on an ordinary page

**Symptom.** Screenshots intermittently took many seconds; some hit the dispatch
timeout.

**Investigation (and a wrong turn, documented for honesty).** I first blamed
**attach/detach churn** in `withPlaywrightPage` and rewrote it to cache/reuse
Pages. That was wrong. Adding `ext.pw.timing` instrumentation proved it:

```
attachMs=79   callbackMs=13303   ← attach is free; page.screenshot() took 13.3s
attachMs=0    callbackMs=130
attachMs=0    callbackMs=4857
```

`application.attach()` is **cheap (~0–80 ms)**. The entire cost is
`page.screenshot()` itself — Playwright blocks on `document.fonts.ready` +
render/animation **stability** before capturing. Caching Pages gave zero benefit
(only a persistent debugger banner per tab), so it was **reverted**.

**Fix.** Pass `{ animations: 'disabled', caret: 'hide', timeout: 12_000 }` to
`page.screenshot()` and a bounded `waitForLoadState('load')` first. Stable-page
screenshots dropped from ~13 s to **0.4–0.8 s**. `withPlaywrightPage` stays
attach-per-call (with a code comment forbidding the caching dead-end).

**Tests.** Unit: asserts the screenshot options + load-wait are passed. E2e:
"take_screenshot returns a real image on a settled page" (< 10 s).

**Known, accepted limit.** A screenshot taken **within ~5 s of a navigation** is
inherently ~6–9 s (the renderer hasn't painted the new page). It is now
**bounded and reliable** (no hangs/timeouts), just not fast. Real agent
think-time between tool calls avoids this; only zero-gap back-to-back hits it.

---

## Why these were missed before

The pre-existing e2e specs for the tool path (`click-and-form.spec.ts`,
`tools.spec.ts`) drive **inline `executeScript` simulations**, and both
`tools.spec.ts` and `connection-e2e.spec.ts` literally
`throw "Direct tool invocation not supported from extension page"`. **Nothing
exercised the real `tool-dispatcher` playwright-crx path** where these bugs
live. Closed in v0.5.14 by `tests/e2e/tool-path-real.spec.ts`, which drives the
real path via a `role=mcp` client, plus unit tests that run the real handler
logic against a controllable fake Page.

---

## Test layering added in v0.5.14

| Failure | Unit (CI) | Real e2e |
|---|---|---|
| click false-timeout / no re-resolve | ✅ | ✅ |
| empty snapshot → honest note | ✅ | ✅ |
| screenshot stability waits | ✅ | ✅ |
| press_key / fill_form bounding | ✅ | (class) |
| page usable after navigating click | — | ✅ |

`tool-path-real.spec.ts` is a **deliberate-run** integration test (prereq:
bridge running + a real browser connected; it `test.skip`s otherwise) — matching
the repo's `real-edge-*` convention. It does not launch its own Chromium because
a Playwright-owned browser contends for CDP with the extension's playwright-crx.

---

## Also shipped in v0.5.14 (connection layer — full RCA: `rca-2026-06-18-green-but-zero-tabs.md`)

- **4002 reconnect loop** (regression I introduced in v0.5.11): the collision
  guard decided by *liveness* ("incumbent alive ⇒ newcomer is a duplicate" —
  false). Re-fixed to decide by **identity**: the newest `?role=relay` wins a
  browserId collision; no liveness guess.
- **"Open diagnostics dashboard" button** is now always clickable (was disabled
  when the connection was lost — exactly when you need diagnostics).
- **Lock-file bind race**: lock file is written on the `listening` event, with a
  watchdog that exits cleanly if the port never binds (Windows hang).
- New resilience/chaos coverage: `connection-resilience.spec.ts`,
  `chaos-connection.spec.ts`, and the live smoke harness (`tests/smoke/`).
