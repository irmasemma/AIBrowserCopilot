# E2E test catalog

All e2e specs live in `tests/e2e/`. **25 spec files, ~344 test cases.**

Browser legend: **Chromium** = Playwright's bundled Chromium (unpacked extension, throwaway profile); **Real Edge (CDP)** = attaches over CDP to an Edge you start yourself; **Real install** = installs into / hijacks a real browser profile (kills the running browser); **Live bridge** = talks to an already-connected real browser.

## Test isolation — `AGENTHUB_INSTALL_DIR`

Every spec that spawns its own bridge sets `AGENTHUB_INSTALL_DIR=<tempdir>/agenthub`
(alongside the legacy `LOCALAPPDATA=<tempdir>` for Windows back-compat) so the
bridge writes its lock file + logs into the test's temp directory instead of the
developer's real install dir. This works on **Windows, macOS, and Linux**
identically — the bridge's resolver
(`packages/native-host/src/shared/install-dir.ts`) honors the env var first on
every platform, then falls back to the OS default. The helper has a paired
copy (`packages/native-host-helper/src/install-dir.ts`) with mirror unit tests
asserting identical behavior. Set the var yourself if writing a new
bridge-spawning spec; do **not** rely on `LOCALAPPDATA` alone, it only worked
on Windows. Background: `docs/rca-2026-06-23-allowlist-leak-and-install-dir.md`.

## Free-port allocation

Bridge-only specs (`chaos-connection`, `connection-resilience`) ask the OS for
an ephemeral port via `net.createServer().listen(0)` instead of picking from a
20k-port range randomly. The kernel-assigned approach effectively eliminates
the "bridge never came up" flakes caused by port collisions on Windows. New
specs should follow the same pattern.

## New: `threads-export-bundled.spec.ts`

| Field | Value |
| --- | --- |
| File | `tests/e2e/threads-export-bundled.spec.ts` (+ fixture `fixtures/threads-feed.html`) |
| Tests | 1 |
| Browser | Chromium (headed) |
| Chain | real `claude` CLI → `agenthub` MCP → test bridge (:7483) → extension → feed fixture on `http://127.0.0.1` |
| What it does | Loads the unpacked extension in headed Chromium, serves a Threads-style feed (8 posts) on 127.0.0.1, then starts a real Claude (haiku) session and asks it to export the posts. Claude drives MCP itself: `list_tabs` → `take_screenshot` → `scroll_page` → `get_page_content`. |
| Asserts | Claude exits clean, ≥1 agenthub MCP tool was called, and **≥5 posts exported with non-empty text** (got 8). Content values not checked. |
| Substitutions | Bundled Chromium (Chrome Dev 151 won't load unpacked — verified); fixture feed (live `@tech.mom_us` is login-walled); no `npx` installer (uses :7483 fallback). |

## Soak: `threads-soak-two-browser.spec.ts`

Long-running stability soak: two browsers on one bridge (A = local fixture feed,
B = a live public site, default `stackoverflow.com/questions`), each driven by a
real Claude CLI session that re-runs an export every `SOAK_INTERVAL_MIN`. Hard
gate: every cycle both browsers stayed `live` (zero connection drops). Per-cycle
data → `test-results/soak-timeline.ndjson`; exported items → `test-results/exports/`.

```bash
# 10h @ 10-min cadence. On a headless Linux box wrap with xvfb-run (headed Chromium).
SOAK_DURATION_MIN=600 SOAK_INTERVAL_MIN=10 \
  xvfb-run -a npx playwright test tests/e2e/threads-soak-two-browser.spec.ts --project=chromium-extension
# Quick smoke: SOAK_DURATION_MIN=2 SOAK_INTERVAL_MIN=1
```

Last full run (2026-06-23): 10.1h, 61 cycles, **0 drops** — see `docs/soak-2026-06-23/`.

### Remote log shipping → Neon (opt-in)

`SOAK_REMOTE_LOGS=1` makes the soak write `<installDir>/logs-config.json` so the
bridge ships bridge+ext records to the Neon-backed ingest endpoint
(`packages/log-ingest/`). Secrets come from env — never committed. At startup it
runs a **ship-probe** (sentinel POST to `/api/logs`) that **fails the run fast**
unless `HTTP 200 / inserted>=1`, and prints the run's `install_id`.

```bash
SOAK_REMOTE_LOGS=1 \
SOAK_LOG_ENDPOINT="https://<log-ingest>.vercel.app/api/logs" \
SOAK_LOG_KEY="<INGEST_KEY>" \
SOAK_DURATION_MIN=600 SOAK_INTERVAL_MIN=10 \
  xvfb-run -a npx playwright test tests/e2e/threads-soak-two-browser.spec.ts --project=chromium-extension
```

Verify rows landed (Neon SQL editor), using the `install_id` the run prints:

```sql
select count(*), min(received_at), max(received_at)
from logs where install_id = '<INSTALL_ID>';

select received_at, src, lvl, event
from logs where install_id = '<INSTALL_ID>' order by received_at desc limit 50;
```

Note: remote shipping is **opt-in per machine** — the installer does NOT enable it,
so end-user installs ship locally only unless a `logs-config.json` with a `remote`
block is present.

## Full catalog

| Tests | Spec | Browser | Covers |
| --- | --- | --- | --- |
| 132 | `form-stress.spec.ts` | Chromium | Form filling across 20 framework fixtures (React/Vue/Angular/Svelte/Lit/shadow-DOM/iframes/…) |
| 43 | `form-filling.spec.ts` | Chromium | Core fill_form behavior on common form shapes |
| 26 | `forms-extraction.spec.ts` | Chromium | read_form / extract from forms |
| 25 | `tools.spec.ts` | Chromium | Tool dispatcher surface (navigate, click, content, etc.) |
| 14 | `click-and-form.spec.ts` | Chromium | Click + form interaction flows |
| 11 | `multi-profile-fanout.spec.ts` | Chromium | Tab namespacing, conditional activation, SW keepalive, MCP envelope translation |
| 10 | `connection-e2e.spec.ts` | Chromium | Discovery → WS connect → server_info handshake |
| 9 | `install-lifecycle.spec.ts` | Chromium | Install/uninstall lifecycle states |
| 9 | `extension.spec.ts` | Chromium | Extension load + side panel basics |
| 8 | `tool-path-real.spec.ts` | Live bridge | Full tool round-trip through an already-connected real browser |
| 6 | `multi-client-routing.spec.ts` | Chromium ×2 | Two profiles on one bridge: distinct registration, fan-out aggregation, prefix routing, cross-browser isolation, survivor |
| 6 | `install-flow.spec.ts` | Chromium | Installer steps / registration writes |
| 6 | `install-and-chat.spec.ts` | Real install | Side-panel chat + no-bridge resilience + recovery to Connected |
| 6 | `threads-export-bundled.spec.ts` | Chromium | **(new)** real Claude exports a feed via MCP — see table above |
| 8 | `test-infra-regressions.spec.ts` | None (logic) | **(new)** regression guards: lock-file readiness signal, Chrome-Dev-151 load-extension block, AGENTHUB_TEST_ env-var docs |
| 1 | `threads-soak-two-browser.spec.ts` | Chromium ×2 | **(new)** long soak — see section below |
| 5 | `site-access-banner.spec.ts` | Chromium | Site-access permission banner behavior |
| 5 | `connection-resilience.spec.ts` | Chromium | Reconnect / backoff after drops |
| 5 | `chaos-connection.spec.ts` | Chromium | Connection under injected chaos/faults |
| 2 | `real-edge-via-cdp-mcp.spec.ts` | Real Edge (CDP) | MCP tool calls against real Edge |
| 2 | `real-edge-via-cdp-forms.spec.ts` | Real Edge (CDP) | Form filling against real Edge |
| 2 | `install-and-connect.spec.ts` | Real install | Clean + stale reinstall → Connected → claude -p round-trips |
| 1 | `real-edge-via-cdp-sidepanel.spec.ts` | Real Edge (CDP) | Side panel against real Edge |
| 1 | `real-edge-cdp.spec.ts` | Real Edge (CDP) | Baseline CDP attach to real Edge |
| 1 | `real-edge-grant.spec.ts` | Chromium | Permission-grant flow (bundled Chromium despite name) |
| 1 | `edge-diag.spec.ts` | Chromium | Diagnostics smoke (bundled Chromium despite name) |
