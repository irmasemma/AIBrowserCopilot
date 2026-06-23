# Stability assessment — are we stable, or patch-over-patch? (2026-06-19, post v0.5.14)

A calibrated, honest answer to: *"are we confident this is a stable product now,
not patch over patch?"* No reassurance theater — this records what is actually
root-caused, what is still real risk, and the specific moves that convert
"better" into "durably stable."

**Verdict:** more confident than before, **not** "stable, done." The bleeding
stopped and the next regression in these areas gets *caught* instead of shipped.
The connection *architecture* is not yet at its final shape.

---

## What is genuinely root-caused now (not patches)

- **click_element hang / false-timeout** — fixed at the source: removed the
  unbounded post-mutation locator re-resolve. The whole *class* (re-resolving a
  detached/navigated element) is gone, applied to `press_key`/`fill_form` too.
- **take_screenshot slowness** — fixed at the actual cost. Instrumentation
  proved `attach` is ~0–80 ms and `page.screenshot()`'s font/animation
  stability wait was the entire cost; `animations:'disabled'` took it 13 s →
  0.4–0.8 s. A Page-caching "optimization" was tried and **reverted** as useless
  (it chased the wrong layer).
- **4002 reconnect loop** — collision is decided by **identity** (newest
  `?role=relay` wins), not a liveness heuristic. That heuristic was the
  structural cause; the fix is structural, not a guard.
- **Real regression gates now exist** on the tool path — unit locks in
  `tool-dispatcher.test.ts` + the real e2e `tests/e2e/tool-path-real.spec.ts`
  (MCP → bridge → extension → playwright-crx → Chrome). This is the single
  biggest anti-"patch-over-patch" change: regressions get caught, not shipped.

## What is still real risk — named, not hidden

1. **The connection layer is still architecturally heavy.** The standing
   design-gap thesis holds: ≥5 overlapping reconnect/reconcile/backoff loops,
   MV3 service-worker eviction recovery, and lock-file bind races. v0.5.11–0.5.14
   fixed the acute bugs but did **not** redesign this into one explicit state
   machine. **This is where the next surprise most likely comes from.**
2. **playwright-crx post-navigation timing is inherent.** A screenshot/snapshot
   taken within ~5 s of a navigation is ~6–9 s (the renderer hasn't painted the
   new page). It is bounded and safe now, but not fast — and playwright-crx is a
   finicky dependency we don't control.
3. **The e2e gate is deliberate-run, not auto-CI.** `tool-path-real.spec.ts`
   needs a live bridge + a connected real browser (it `test.skip`s otherwise),
   because a Playwright-launched browser contends for CDP with the extension's
   playwright-crx. If nobody runs it before a release, a regression can still
   slip. The gate exists but is not *enforced*.

## The two moves that make it durable (not more patches)

These are deliberate engineering pieces, not band-aids:

1. **Consolidate the connection layer into a single explicit state machine.**
   One reconnect path; decisions by invariant/identity, never by timing or
   liveness guesses; eviction recovery and lock-file ownership modeled as
   explicit states. This retires the largest remaining risk class (item 1
   above) instead of patching its symptoms one at a time.
2. **Wire the real e2e + smoke into the release as an enforced gate.** Make a
   `v*` tag (or a pre-release step) require the live tool-path checks to pass,
   so a regression cannot ship silently (closes item 3).

## Bottom line

- Today's release (v0.5.14) is solid and verified; the fixed classes are
  root-caused, and they're now covered by tests.
- "Durably stable, not patch-over-patch" is **not yet true of the connection
  architecture** — that needs the state-machine consolidation, not another fix.
- Recommended next focused piece: scope and do the connection-layer
  consolidation (move 1), then enforce the e2e gate (move 2).

Related: `docs/rca-2026-06-19-playwright-tool-path.md`,
`docs/rca-2026-06-18-green-but-zero-tabs.md`.
