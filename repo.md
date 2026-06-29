# Two-browser soak test — status & handoff

_Last updated: 2026-06-24. Branch: `multi-client-architecture`._

Handoff notes so any agent on any machine can continue the soak-test work.

## What the test is

`tests/e2e/threads-soak-two-browser.spec.ts` — an endurance/integration soak.
It launches **two real Chrome windows**, each with the AgentHub extension loaded,
both connected to one local bridge (`node packages/native-host/dist/index.js`,
owns port 7483). Every `SOAK_INTERVAL_MIN` it starts a fresh Claude CLI session
per window and has it drive the page via the agenthub MCP tools.

- **Window A (fixture):** a generated **2-page feed, 100 records/page** served by an
  in-test HTTP server. Records **lazy-load on scroll** (chunks of 20) and the
  "Next page" link is hidden until all 100 load — so reaching 200 records genuinely
  requires **scroll + pagination**. Driven by `sonnet`, 300s timeout.
- **Window B (live site):** Stack Overflow questions list. The agent dismisses any
  banner, screenshots, scrolls, and extracts **≥15 questions** with
  votes/answers/views. Driven by `sonnet`, 150s timeout.

Per cycle it asserts both browsers stayed `live` (hard gate = 0 drops) and saves
each session's exported JSON + screenshot to `test-results/exports/`. A timeline
is appended to `test-results/soak-timeline.ndjson`. Logs ship to a Neon-backed
ingest endpoint by default (see below).

## How to run

```bash
cd <repo>            # repo lives at C:\dev\1M\ai-browser-copilot on the dev box
# single cycle (fast sanity — note: 1-cycle runs FAIL the soft gates by design,
# because tolerance = floor(cycles * 0.2) = 0; use for smoke only)
SOAK_DURATION_MIN=1  SOAK_INTERVAL_MIN=1  npx playwright test tests/e2e/threads-soak-two-browser.spec.ts --project=chromium-extension
# multi-hour
SOAK_DURATION_MIN=600 SOAK_INTERVAL_MIN=30 npx playwright test tests/e2e/threads-soak-two-browser.spec.ts --project=chromium-extension
```

Env knobs: `SOAK_DURATION_MIN` (default 60), `SOAK_INTERVAL_MIN` (default 5),
`SOAK_FIXTURE_MODEL` (default sonnet), `SOAK_SECOND_MODEL` (default sonnet),
`SOAK_SECOND_URL` / `SOAK_SECOND_MATCH` (default Stack Overflow),
`SOAK_REQUIRE_GRANT=0` (downgrade the host-access gate to a warning — for RCA),
`SOAK_REMOTE_LOGS=0` (disable Neon shipping). Remote creds auto-resolve from
`packages/log-ingest/.env.production.local` (INGEST_KEY) and
`%LOCALAPPDATA%/agenthub/logs-config.json` (endpoint); ship-probe runs at start.

## Operator runbook — long soaks (4–12h)

When asked to "run the Nh soak", do exactly this:

1. `cd C:\dev\1M\ai-browser-copilot`. If a new release was just built, confirm
   `packages/native-host/dist/index.js` and `packages/extension/dist/chrome-mv3/manifest.json`
   are freshly rebuilt (the test loads these).
2. **Clean first** (a leaked temp profile once filled the disk → mass failures):
   ```bash
   rm -rf "$LOCALAPPDATA/agenthub"/../Temp/copilot-soak-*   # or %LOCALAPPDATA%\Temp\copilot-soak-*
   rm -f test-results/soak-timeline.ndjson soak-run.log && rm -rf test-results/exports
   ```
3. **Smoke one cycle first** (`SOAK_DURATION_MIN=1`). It will report `1 failed`
   because soft-gate tolerance is 0 on a single cycle — that's expected; what you
   check is the per-cycle log line: `fixture=200 ... SO=15(fields 15) SOshot=true`,
   `drops=0`. Only proceed if that line is healthy.
4. **Launch the long run in the background** (interval is almost always 30 min):
   ```bash
   SOAK_DURATION_MIN=<MIN> SOAK_INTERVAL_MIN=30 npx playwright test tests/e2e/threads-soak-two-browser.spec.ts --project=chromium-extension > soak-run.log 2>&1
   ```
   Durations: **4h=240, 6h=360, 8h=480, 10h=600, 12h=720**. Cycles ≈ MIN/30.
5. **Keep the machine idle** during the run — no RDP/SSH-heavy work, no rebuilds,
   no sleep. The Playwright budget is `(DURATION+12) min`; if cycles run slower
   than the 30-min interval (machine busy/suspended) the run can trip that timeout
   with fewer cycles done. That is environmental, not a test regression.
6. **Pass criteria:** `1 passed`, `drops=0`, and every cycle fixture ≥150 (scroll+
   pagination) and SO ≥15 + screenshot. Read from `test-results/soak-timeline.ndjson`.
7. **Verify Neon ingestion** by the run's `install_id` (start event of the
   timeline). Read-only query:
   ```bash
   cd packages/log-ingest && node -e "const fs=require('fs');const url=(fs.readFileSync('.env.production.local','utf8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m)||[])[1];const {neon}=require('@neondatabase/serverless');const sql=neon(url);const ID='<install_id>';(async()=>{console.log(await sql\`select count(*)::int n,min(received_at) lo,max(received_at) hi from logs where install_id=\${ID}\`);console.log(await sql\`select src,count(*)::int n from logs where install_id=\${ID} group by src\`)})()"
   ```
   Expect rows from both `src=bridge` and `src=ext` (a ~4h run produced ~1,400).

Notes: remote shipping is best-effort (5s flush, batch ≤50, drops on 5xx) and
covers bridge+extension logs only — not the Claude CLI transcript.
`SOAK_REMOTE_LOGS=0` disables Neon; `SOAK_REQUIRE_GRANT=0` downgrades the
host-access gate to a warning. Endpoint resolves from
`%LOCALAPPDATA%/agenthub/logs-config.json` (currently
`https://log-ingest-irmas-projects-28aa1036.vercel.app/api/logs`).

## Hard-won lessons (RCA results)

1. **Disk-full was the real cause of "connection drops."** The test leaked temp
   Chrome profiles (`os.tmpdir()/copilot-soak-*`); 70 piled up → C: hit 100% →
   service-worker timeouts, failed reads, "drops." With headroom: 0 drops. The
   UUID-change theory was wrong — do NOT touch the extension UUID code.
   Mitigation: profiles are cleaned in `afterAll` (escalating retry for Windows
   file locks); a couple may still linger but disk no longer grows.

2. **`chrome.permissions.contains()` false-negatives.** It reported `<all_urls>`
   absent while reads worked. The capability gate uses a **real read**
   (`chrome.scripting.executeScript`, the same path as `get_page_content`).

3. **The runtime `<all_urls>` grant is unreliable in automated Chromium.** Fix:
   load a **test-only patched copy** of the built extension with the specific test
   origins promoted into `host_permissions` (`buildPatchedExtension`). Specific
   host patterns auto-grant at load — no flaky prompt. The shipped extension is
   untouched; the copy is derived from the live build each run, so it can't drift.

4. **Scroll wasn't being exercised on a static page** — `get_page_content` reads
   the whole DOM, so nothing forced a scroll. Hence Window A's lazy-load + hidden
   pager design. Stack Overflow uses pagination, not infinite-scroll, so it can't
   prove scroll on its own.

5. **Heavy extraction overruns timeouts.** Dumping 200 records overran the 150s
   cap → empty results. `runExport` timeout is now configurable; the fixture gets
   300s.

## Key commits (branch `multi-client-architecture`)

- `0c20746` remote log shipping ON by default (auto-resolve creds)
- `a536697` Window B drives Stack Overflow via MCP — ≥questions + screenshot
- `3d6701a` deterministic host access (patched manifest) + capability gate + hardened cleanup + identity probe
- `d4b11a3` Window A exercises scroll + pagination (2 pages, 200 records)

## Current state

- Single-cycle smoke PASSES: Window A = 200 records (scroll + pagination proven),
  Window B = 15 SO questions + screenshot, 0 drops, ships to Neon.
- **10-hour run @ 30-min cadence PASSED clean (2026-06-24 → 06-25).**
  `SOAK_DURATION_MIN=600 SOAK_INTERVAL_MIN=30`, **20/20 cycles, 0 drops**;
  fixture ≥150 records 20/20, SO ≥15 questions 20/20, SO screenshots 20/20.
  Neon `install_id 15cfb36b-200e-4ae4-82e5-cde98b9c0f43`; ship-probe 200/inserted=1.
  Result: `1 passed (10.0h)`. This is the validated baseline — the test and the
  fixes in the commits below are confirmed stable over a full multi-hour soak.
- **4-hour run on the new release build PASSED clean (2026-06-26).** 8/8 cycles,
  0 drops, fixture ≥150 8/8, SO ≥15 + screenshot 8/8. Neon verified: 1,430 rows
  (bridge 830, ext 600), `install_id b9b8ccf1-ca7a-47fa-b9f1-2cb2da39d8c2`.
- **Caveat learned:** a 10h attempt failed on the Playwright `(DURATION+12)min`
  timeout after only 13/13 (clean) cycles because the machine was busy/suspended,
  so cycles ran ~10x slower. Keep the box idle for long runs (see runbook step 5).

## Caveats

- 1–2 temp profile dirs can linger on Windows (locked at teardown); disk-safe.
- Single-cycle runs fail the soft gates by design (zero tolerance). Use multi-cycle.
- `tests/e2e/fixtures/threads-feed.html` is now unused (fixture is generated in-spec).
