# Findings & fix — diagnostics panel: too many signals + a false "flapping" verdict (2026-06-30)

Status: **implemented, reviewed by ui-ux-engineer (redesign) + full-stack-engineer
(correctness, AGREE/ship-ready), committed.** Extension-only; no release cut (these
changes sit on top of v0.5.17 and can be loaded unpacked to test).

## 1. The problem (reported from a live screenshot)

After the v0.5.17 fixes, a user opened the side panel mid-recovery and saw this:

```
↻ Connection keeps dropping
  AgentHub reconnects to your browser, but each link gets replaced before a
  command can finish… A restart usually clears this up.
  [Restart bridge] [Reload extension]

Connection keeps dropping                          ← duplicate verdict echo
Versions don't match: browser 0.5.17, bridge unknown, helper 0.5.10. …  ← live region
⚠ Versions don't match  (full callout, browser 0.5.17 / bridge unknown / helper 0.5.10)

Connection diagnostics   [Refresh] [Copy report] [Restart bridge]   ← Restart bridge AGAIN
…
✕ Lock file present  No service lock file. Bridge isn't running.    ← CONTRADICTS the header
```

User's words: *"looks like too many signals, not sure user will understand what to
press."*

Two distinct defects:

- **A false, contradictory headline.** The header said **"Connection keeps
  dropping"** (flapping — implies a *live* link that churns) while the diagnostics
  said **"Bridge isn't running"** (no lock file — there is *no* link). Both cannot
  be true. This is the same "UI lies about health" class the project keeps fighting.
- **Too many co-equal alarms.** A duplicate verdict echo + a full version-mismatch
  callout + a failing diagnostic step + **"Restart bridge" shown twice** — three
  things shouting "do something," no single clear action.

## 2. Root cause

### A. The false verdict (correctness)

`deriveVerdict` (`connection-verdict.ts`) ranks **Flapping** at precedence 2, above
the **"bridge not running"** verdict at precedence 3. The Flapping branch had a
client fallback:

```js
flappingFromClient = ctx.reconnectsThisSession >= FLAPPING_RECONNECTS_THRESHOLD; // (3)
if (flappingFromBridge || (api === null && flappingFromClient)) { … flapping … }
```

`api === null` means `/api/state` was unreachable — but that is unreachable
**because the bridge is down**. A stale `reconnectsThisSession` counter left over
from a previous storm therefore made a *dead* bridge look like a *churning* one,
and Flapping (rank 2) masked "bridge not running" (rank 3) before it was ever
reached.

### B. The signal pile-up (information hierarchy)

The panel rendered, unconditionally and at equal weight: the header title **again**
(a "verdict echo"), the **full** version-mismatch callout regardless of whether
version skew was the actual problem, and its **own** "Restart bridge" button even
when the header already offered restart/start. Three alarms, two restart buttons.

## 3. The fix

### A. Precedence guard — flapping can't mask a down bridge

`connection-verdict.ts`:

```js
const isDefinitelyDown = reason === 'no_lock_file' || reason === 'bridge_not_started';
const flappingFromClient = !isDefinitelyDown
  && ctx.reconnectsThisSession >= FLAPPING_RECONNECTS_THRESHOLD;
```

When the discovery chain has definitively determined there's no running bridge, a
stale client counter can no longer force a "flapping" headline. The verdict falls
through to the truthful **"Bridge isn't running"** with its one action, **Start
AgentHub service**. The guard is identity-based (keys on what the helper actually
found), not a liveness guess, and it does **not** suppress legitimate flapping —
the inverse test (`null reason + reconnects≥3 → still flapping`) proves it.

### B. One primary verdict + one action (hierarchy)

`diagnostics-panel.tsx` + `connection-header.tsx`:

- **Removed the duplicate verdict echo.** The header title is the single visible
  headline and sits directly above the panel (the panel only renders inside the
  header), so the echo was pure repetition. The ARIA polite live region for
  screen-reader announcement is retained.
- **Version-mismatch callout is now conditional.** Full amber callout **only** when
  `verdictKind === 'version_mismatch'` (skew is the actual problem); otherwise a
  single demoted line — *"Version mismatch (browser X, bridge Y, helper Z) — the
  update command below fixes this too."* All three versions are still shown in both
  forms; nothing is hidden. The header now passes `verdictKind` to the panel.
- **De-duplicated "Restart bridge."** The panel's button is hidden when the header
  verdict already surfaces `restart_service` or `start_service`
  (`showPanelRestart`). It is kept for `working`/`untested`/`recovering`/etc. —
  exactly its original purpose: the "tools wedged even though it looks connected"
  recovery. The header now passes `verdictActionIds` to the panel.

## 4. Before / after (the reported state)

| | Before | After |
|---|---|---|
| Headline | "Connection keeps dropping" (**false**) | "Bridge isn't running" (**true**) |
| Primary action | ambiguous (2× Restart, Reload, Start hint) | **Start AgentHub service** (one) |
| Version skew | full co-equal ⚠ callout | one demoted line ("…update command fixes this too") |
| Verdict echo | duplicated header title | removed |
| Restart bridge | shown twice | once (header here; panel in wedged-while-up states) |

## 5. Capability audit — nothing important lost

Verified by reading the diff directly (not just the agents' summary):

| Capability | Where it lives now |
|---|---|
| Copy report | panel toolbar — unchanged |
| Refresh / re-probe | panel toolbar — unchanged |
| Restart bridge | header (when verdict offers it) OR panel (when it doesn't) — reachable in **all 17** verdict states |
| Reload extension / Start service | header buttons (verdict-driven) — unchanged |
| Open diagnostics dashboard | panel — unchanged |
| Diagnostic step checklist | panel — unchanged |
| Always-copyable update command | `CommandBlock` — unchanged, always rendered |
| Version list | full callout when primary; one-line note (all 3 versions) when secondary |
| Runtime details | collapsible `<details>` — unchanged |
| ARIA live region | header + panel sr-only span — both intact |

The only removed element is the **redundant** verdict echo. No state loses access
to restart/start (full enumeration over all verdict kinds confirms it).

## 6. Known residual (honest, bounded, pre-existing)

During a backoff cycle the SW's `diagnosticReason` is briefly `was_connected`
(not yet `no_lock_file`), so for up to ~30 s — until the next `reconcile()` alarm —
a down-but-recently-dropped bridge with a stale `reconnectsThisSession` can still
read as "Connection keeps dropping" while the panel's independent helper-snapshot
poll shows "No lock file." This is the pre-existing source-disagreement (header
derives from `ctx`, panel steps from the helper snapshot); the guard fixes the
**persistent** contradiction, not this transient window. Closing it fully means
propagating `no_lock_file` into the `onClose` path (or gating flapping on
`was_connected` + disconnected state) — a separate story, deferred to avoid risking
suppression of a real flap.

## 7. Verification

- `cd packages/extension && npm run build` — clean.
- `npm test` — **327 pass** (+32 new): the down+stale→not-flapping regression, the
  inverse (null reason still flaps), precedence chain, and panel-restart de-dup
  anchors.
- Reviews: **ui-ux-engineer** (redesign) + **full-stack-engineer** (correctness):
  AGREE / ship-ready; full restart-reachability state table confirmed.

Files: `connection-verdict.ts`, `connection-verdict.test.ts`,
`components/connection-header.tsx`, `components/diagnostics-panel.tsx`.
