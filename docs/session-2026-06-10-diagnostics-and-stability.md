# Session 2026-06-10 — Diagnostics UI + stability rebuild (v0.5.7→v0.5.10)

**Audience:** next LLM session debugging AgentHub. This doc explains what was
shipped, why, and how to spot if any of these fixes regressed.

## Versions shipped this session

- **v0.5.7** — redaction false positives + signal-to-noise + missing instrumentation
- **v0.5.8** — visual health UI at http://127.0.0.1:7483/
- **v0.5.9** — interactive client + browser lists with click-to-expand details
- **v0.5.10** — robust connection-manager + helper status truth fix + per-call drill-down + liveness

## The arc — what changed, why

### Diag UI (v0.5.8 / v0.5.9 / v0.5.10)

Bridge now serves a self-contained HTML dashboard at `http://127.0.0.1:7483/`. Built it because user kept asking "is the bridge actually running?" — `/api/state` and the dashboard make that answer obvious without grepping logs.

Key pieces:
- **4 component cards** (AI Assistant, Bridge, Browser Extension, Connected Browsers) in a flow diagram with arrows showing data direction
- **Status badges driven by REAL data** — not socket presence. Browsers card shows `liveness=live|stale|unknown` derived from `browserLastSeen` (updated on every inbound WS frame)
- **Recent Activity timeline** with last 50 tool calls — each row clickable
- **Click row → modal opens with step-by-step trace** (`/api/request/<id>` endpoint) showing the full request lifecycle in plain English:
  - "Bridge picked chrome to run list_tabs."
  - "Bridge knocked on chrome's door (sent a tiny ping) to check it is awake."
  - "chrome answered the ping — it is awake."
  - "Bridge asked chrome to run list_tabs and is waiting for the answer."
  - "chrome finished list_tabs in 794 ms. Bridge is sending the result to your AI."
- **Per-browser reload** — diag UI sends `{type:'reload', source:'diag-ui'}` only to the targeted WS, instead of broadcasting
- **CORS for chrome-extension:// origins** on GET endpoints so side panel can use `/api/state` as the source of truth (eliminates 5-40s Windows native-messaging IPC tax)

### Two critical bugs root-caused and fixed (v0.5.10)

Both surfaced under "Chrome's extension doesn't respond / side panel says bridge isn't running." Both confirmed via log analysis, not guessing.

#### Bug A — extension orphan-socket race

**Symptom:** Tool calls timed out at 10s. `bridge.log` showed `bridge.browser.replaced` events spamming (one per ~30s) — meaning the same browserId was opening new sockets without the old ones being closed cleanly.

**Trace from logs:**
```
15:39:37.482 bridge.tool_request.sent     (on WS B)
15:39:37.517 ext.tool_request.received    (extension's NEW connection received it)
15:39:37.561 ext.tool.dispatch.start
15:39:37.588 ext.tool.dispatch.complete   ← list_tabs SUCCEEDED in 45ms
15:39:47.491 bridge.fanout.target_timed_out (10s later — bridge never got response)
```

The extension processed list_tabs in 45ms and tried to send the response. But the response went via `manager.getRelay().sendToolResponse()` — which uses the CURRENT relay. By the time the extension was ready to respond, a reconcile cycle had created Relay C; the response went out on Relay C's WS, but the bridge was waiting for a response on the pendingRequest registered for Relay B's WS. **No id collision happens** because each pendingRequest is keyed by browserBoundId AND tracked per-WS handler. The response on Relay C went to its own message handler which looked up pendingRequests.get(id) — found nothing (since the pending was registered on Relay B's flow), silently dropped. Bridge timed out at 10s.

**Root cause:** `connection-manager.openRelay()` assigned `relay = createRelay(...)` without closing the previous `relay`. The old `Relay` instance became unreachable garbage, but its underlying WS stayed open. Multiple live Relay instances → request landed on socket X, response sent via socket Y.

**Fix (in `packages/extension/src/background/connection-manager.ts`):**
- `openRelay()` now calls `relay.disconnect()` BEFORE creating the new one
- `stopAll()` (called from retry/reconcile) also closes the relay
- New log event `ext.ws.replacing_relay` makes future occurrences visible

**Verification:** ran 15 chrome calls + 5 edge calls back-to-back, all succeeded in 10-14ms. Previously, every other call timed out.

#### Bug B — helper Windows `process.kill(pid, 0)` false-negative

**Symptom:** Side panel showed "Bridge isn't running — A bridge is registered but not currently running" with a fail next to "Process alive" — but bridge was actually serving MCP traffic at the same time.

**Trace from logs:**
```
helper.invoke.replied  action=get_service_status
  reason=bridge_not_started pidAlive=False portListening=False wsHealthy=False
```

Direct PowerShell verification: `Get-Process -Id 32804` showed the bridge IS alive. `Get-NetTCPConnection -LocalPort 7483` showed it IS listening.

**Root cause:** `process.kill(pid, 0)` in the `pkg`-bundled helper binary returns false on Windows when the target process belongs to a different process tree / security context. Helper is spawned by Chrome via native messaging; bridge is spawned by autostart. Different parents → different security tokens → kill(0) fails with EPERM → caught → returns false.

Then the gating logic in `service-status.ts` line 243 was:
```ts
if (lockFile.exists && (pidAlive === true || pidAlive === null)) {
  portListening = await probePort(port);
}
```
When `pidAlive=false`, port was never even probed. `deriveReason()` short-circuited to `'bridge_not_started'`.

**Fix (in `packages/native-host-helper/src/service-status.ts`):**
- ALWAYS probe the port if lock file exists (don't gate on pidAlive)
- If port responds, override pidAlive to true (we have proof it's alive)
- `deriveReason()` short-circuits to `'connecting'` when `wsHealthy=true`, regardless of pidAlive

**Verification:** after fix, helper reports `pidAlive=True portListening=True wsHealthy=True` consistently. Side panel went green.

### Other v0.5.7+ improvements

- **Redaction false positives fixed** — JWT regex tightened to require 8/8/16-char segments (no longer matches `0.5.6` semver). `action` removed from URL_KEYS so verb names like `get_service_status` aren't redacted to `[len=18]`.
- **Helper probes separated from real browsers** — `helper-probe` connections now log as `bridge.probe.*` instead of polluting `bridge.browser.*`.
- **Origin rejection dedupe** — same rejected origin only logged once per 60s with a `suppressedSinceLastLog` count.
- **MCP initialize/tools_list instrumentation** — handshake failures now visible.
- **Per-target fanout instrumentation** — `bridge.fanout.target_sent/replied/timed_out` per browser.
- **`spawnedPid` rename** — helper no longer collides its child's pid with its own writer pid in log lines.

## What an LLM helping a user with AgentHub should know

1. **Always check `http://127.0.0.1:7483/` first.** It shows truth. Side panel may lag (helper invocations take 5-40s on Windows IPC).
2. **Check `/api/state.browsers[].liveness`** — a connected browser with `liveness=stale` means the SW is wedged. Recommend "Reload this browser" button (per-browser, not all).
3. **Click on Recent Activity rows** for the full per-call trace with kid-friendly cause messages.
4. **If you see `bridge.browser.replaced` spamming in logs** — the connection-manager single-relay rule was broken again. Check `openRelay()` and `stopAll()` in `packages/extension/src/background/connection-manager.ts`.
5. **If side panel disagrees with reality** — check helper.log. If `pidAlive=False` but bridge IS running, the override in `service-status.ts` may have regressed. Test: `deriveReason({ pidAlive: false, wsHealthy: true })` must return `'connecting'`.

## Manual reset recipe (when nothing works)

```powershell
# 1. Close ALL browser windows (Chrome + Edge + Brave + Arc + Vivaldi)
Get-Process -Name 'chrome', 'msedge', 'brave' -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Kill bridge + all helpers
Get-Process | Where-Object { $_.Name -like '*agenthub*' } | Stop-Process -Force

# 3. Reinstall (downloads latest binaries from public release-assets repo)
npx agenthub-setup@latest --extension-id <your-chrome-ext-id>

# 4. Open browsers, reload the AgentHub extension in chrome://extensions/
```

## Test counts (post-v0.5.10)

| Package | Tests |
|---|---|
| native-host | 172 |
| native-host-helper | 21 |
| extension | 258 |
| installer | 311 |
| **Total** | **762** |

## Files touched (v0.5.7 → v0.5.10)

Major changes:
- `packages/native-host/src/service.ts` — MCP init/tools_list instrumentation, per-target fanout tracking, liveness probe before tool requests, browserLastSeen + pendingPongs, periodic 15s liveness sweep, `bridge.browser.replaced` warn event
- `packages/native-host/src/diag-server.ts` — `/api/state` (with browser liveness), `/api/request/<id>`, CORS for chrome-extension origins, OPTIONS preflight
- `packages/native-host/src/diag-page.ts` — full dashboard HTML (~1100 lines): flow diagram, interactive lists, per-call modal, log viewer with filter, brand chips with scroll-to behavior, stale-SW banner
- `packages/extension/src/background/connection-manager.ts` — single-relay rule (close before create), `setLoggingEnabled` integration, PID-change detection
- `packages/extension/src/background/relay-client.ts` — handler for `{type:'reload'}` from bridge
- `packages/extension/src/sidepanel/components/diagnostics-panel.tsx` — uses `/api/state` fast path when WS healthy, helper-stale detection, per-field source annotations, 30s vs 5s poll cadence
- `packages/extension/wxt.config.ts` — added `http://127.0.0.1/*` host permission
- `packages/native-host-helper/src/service-status.ts` — Windows kill-0 false-negative fix, always-probe-port, deriveReason wsHealthy-priority
- `packages/native-host/src/shared/redaction.ts` — JWT regex tightened, `action` removed from URL_KEYS
