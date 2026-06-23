# AgentHub real smoke test

Exercises the **actual production tool path** — connects to the live bridge as
an MCP client (the same `?role=mcp` channel Claude Code / Cursor use) and runs
real tool round-trips against the real extension + real Chrome:

```
list_tabs → get_page_content → take_screenshot          (read-only, default)
+ navigate https://example.com → verify "Example Domain" (--full, destructive)
```

## Why this exists

Per `docs/rca-2026-06-18-green-but-zero-tabs.md`: the side-panel "Connected /
all-green" status only measures **bridge-side** facts (lock file, port,
heartbeat). The only true health signal is a **tool round-trip through the
extension's current socket**. A wedged/orphaned socket still pongs (looks green)
while every tool times out at ~10s and returns empty.

So this test measures the round-trip AND its **latency**: a healthy fan-out
returns in tens of ms; ~10s == `FAN_OUT_TIMEOUT` == the wedge. `list_tabs`
returning 0 tabs in ~10s is flagged explicitly as the green-but-zero-tabs wedge.

## Run

```bash
node tests/smoke/smoke.mjs            # one run; exit 0 = pass, 1 = fail
node tests/smoke/smoke.mjs --full     # also navigate a tab + verify content (DESTRUCTIVE: changes a real tab)
node tests/smoke/smoke.mjs --loop 300 # run every 300s forever; writes a report ONLY on failure
```

Requires the bridge running and at least one Chrome profile with the extension
connected and a tab open. No build step — talks to whatever bridge is live
(port discovered from `server.lock`, override with `AGENTHUB_SMOKE_PORT`).

## On failure → report + logs

Every failure writes `tests/smoke/reports/<timestamp>-smoke-fail.md` containing:
the failed scenarios (with round-trip durations), a `/api/state` snapshot, and
tails of `bridge.log` / `extension.log` / `helper.log`. `reports/` is gitignored
(runtime artifacts).

## Run it "all the time"

- **Quick:** leave `node tests/smoke/smoke.mjs --loop 300` running in a terminal.
- **Background (Windows):** Task Scheduler → run `node …\smoke.mjs --loop 300` at
  logon. Reports accumulate under `reports/` only when something breaks.
- It deliberately uses the **direct MCP path, not `claude -p`** — same
  bridge→extension→Chrome chain, but deterministic and fast (no LLM
  nondeterminism). Use `--full` for the navigate-and-read scenario.

## What it would have caught this session

- **green-but-zero-tabs** (`list_tabs` empty + ~10s) — flagged as the orphan wedge.
- **screenshot hang** (pre-v0.5.13 `captureVisibleTab`) — `take_screenshot` times out.
- **4002 reconnect loop** — tools fail/empty while "connected".
