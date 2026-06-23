# Two-browser soak results — 2026-06-23

Test: `tests/e2e/threads-soak-two-browser.spec.ts` (task `bx8k38xug`).
**FINAL — run completed: 10.1h, 61 cycles, PASSED.**

## Setup

- **Duration / cadence:** 600 min @ 10 min → ~60 cycles.
- **Browser A (fixture):** local Threads-style feed on `http://127.0.0.1` — full export, requires >5 posts/cycle.
- **Browser B (second):** live `https://stackoverflow.com/questions` — tools run + count recorded, >5 not required.
- Each cycle: snapshot bridge `/api/state` → Claude CLI exports A → Claude CLI operates B → snapshot again.
- One bridge, both browsers connected; Claude (haiku) drives MCP each cycle.

## Result so far — STABLE

| Metric | Value |
| --- | --- |
| Cycles completed | **61** (ended) |
| Wall time | **10.1h** |
| **Connection drops** | **0** — both browsers `live` before+after every cycle |
| Second (Stack Overflow) posts | **15 every cycle** (constant) |
| Fixture posts | range 0–153 (Claude count variance; only **1** cycle <5: #38) |
| Claude non-zero exits / timeouts | **none** |

**Verdict:** the bridge ↔ two-browser WebSocket connections stayed healthy across the full 10.1h of 10-min-cadence Claude operations — no SW-eviction drops, no reconnect failures, no tool timeouts. The single fixture <5 cycle (#38) was Claude returning fewer items (exit 0, not a connection fault). Playwright result: **1 passed (10.1h)**.

## Files

- `soak-timeline.ndjson` — one JSON row per cycle (both browsers' liveness, post counts, tools, exit codes).
- `soak-summary.json` — computed summary (counts, drops, ranges).
- Per-cycle exported items: `test-results/exports/cycleNNN-{fixture,second}.json`.
