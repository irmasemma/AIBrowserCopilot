# AgentHub - Development Rules

## Project Structure

Monorepo with 4 packages:
- `packages/extension` — Chrome extension (Manifest V3, WXT, Preact)
- `packages/native-host` — WebSocket relay server (Node.js, MCP SDK)
- `packages/native-host-helper` — Native messaging helper for service discovery (reads lock file)
- `packages/installer` — Setup assistant UI (Ink/React CLI)

## Build & Test Commands

**CRITICAL: Always rebuild compiled binaries, not just TypeScript source. The MCP config and real users run the compiled .exe, not the dev version. Never point configs to dev/source as a shortcut.**

**CRITICAL: When pushing code that changes the native host, ALWAYS publish a new GitHub release with the recompiled binary.** The installer downloads from GitHub releases — if the release is stale, every customer gets the old broken binary. Run `gh release create` after compiling. This is not optional.

```bash
# Full clean build (from project root)
npm run build --workspaces

# Individual packages
cd packages/extension && npm run build
cd packages/native-host && npm run build && npm run compile:win   # ALWAYS recompile the binary
cd packages/native-host-helper && npm run bundle
cd packages/installer && npm run build

# Run all tests
npm test --workspaces

# Run tests for a specific package
cd packages/extension && npm test
cd packages/native-host && npm test

# Run e2e tests
npx playwright test
```

## Verification Before Declaring Done

**CRITICAL: Never tell the user "it should work" or "restart and try". Always verify yourself first.**

Before asking the user to test anything, you MUST:

1. **Clean build** — rebuild any changed package from scratch (`npm run build` or `npm run bundle`), never rely on cached/stale builds
2. **Run unit tests** — `npm test` in affected packages, all must pass
3. **End-to-end verification** — test the actual runtime chain, not just code review:
   - If touching connection/discovery: test the native messaging helper responds correctly, test WebSocket connects with token, verify `server_info` is received
   - If touching tools: test the tool executes and returns expected output
   - If touching UI: verify the built extension loads without errors
4. **Verify file state** — check that built artifacts, manifests, and registry entries are correct and current (not stale)
5. **Check for stale processes** — look for orphaned processes on expected ports that could interfere

### Connection Chain Verification Script

When debugging connection issues, always run this full chain check:

```bash
# 1. Check lock file
cat "$LOCALAPPDATA/agenthub/server.lock"

# 2. Check what's actually listening
netstat -ano | findstr "7483"

# 3. Verify lock file PID matches running process
tasklist | findstr "<PID_FROM_LOCK_FILE>"

# 4. Test native-host-helper returns correct data
node /tmp/test-helper.js  # (create test script that sends read_lock_file via native messaging protocol)

# 5. Test WebSocket connection (origin-auth; no token param needed for local test)
# Connect to ws://127.0.0.1:<PORT>?browserId=test and verify server_info arrives

# 6. Check registry entries
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.agenthub.native_host_helper"
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.agenthub.native_host"

# 7. Check native messaging manifests have correct extension ID in allowed_origins
cat "$LOCALAPPDATA/agenthub/com.agenthub.native_host_helper.json"
cat "$LOCALAPPDATA/agenthub/com.agenthub.native_host.json"
```

## Key Architecture Details

- Native host writes `server.lock` on startup with pid, port, and an empty token field
- Extension uses `com.agenthub.native_host_helper` (native messaging) to read the lock file and discover the port
- Extension connects via WebSocket with `?browserId=<instance-id>` query parameter
- **Auth is origin-based**: WS server's `verifyClient` checks the `chrome-extension://<id>/` origin against `extension-ids.json` or `AGENTHUB_ALLOWED_EXTENSION_IDS` env var — connections from unknown extension IDs are rejected with HTTP 401 before the WS handshake. There is no `?token=` parameter check.
- Lock file location: `%LOCALAPPDATA%/agenthub/server.lock`
- Extension IDs are stored in `%LOCALAPPDATA%/agenthub/extension-ids.json` — must be a JSON array of real Chrome extension IDs, NOT placeholder values like `"myext123"`
- Extension ID (dev, Profile 1): `ehchmchlmggdigicfjfmlgcbhdcdcmll`
- **CRITICAL invariant — single-relay rule** (v0.5.10+): `connection-manager.openRelay()` MUST close the existing `relay` before creating a new one. Without this, retry/reconcile/backoff cycles silently leak WS connections — old WS stays open at OS level, bridge still sees it as "connected", but extension's JS has lost its reference so nothing handles incoming tool_request frames. Result: bridge sends tool_request to socket A, extension is listening on socket B, tool times out at 10s. The fix lives in `openRelay()` and `stopAll()`. If you ever see a `bridge.browser.replaced` log spam pattern, this rule was probably broken again.
- **CRITICAL invariant — helper status truth source** (v0.5.10+): `wsHealthy` is the strongest positive signal. `pidAlive` is advisory only — Windows `process.kill(pid, 0)` from the pkg-bundled helper can false-negative for cross-process-tree perm reasons. `deriveReason()` short-circuits to `'connecting'` when `wsHealthy=true` regardless of `pidAlive`. `getServiceStatus()` ALWAYS probes the port (no longer gates on pidAlive).

## Diagnostics dashboard (v0.5.8+)

Open `http://127.0.0.1:7483/` in any browser while the bridge is running. Single-page HTML served by the bridge. No login (localhost-only). Endpoints:

- `GET /` → dashboard HTML
- `GET /api/state` → bridge info + browsers (with `liveness` field: live/stale/unknown) + mcpClients + recentRequests + recentRejections
- `GET /api/request/<browserBoundId>` → per-request drill-down (step-by-step trace with kid-friendly messages + cause hints)
- `GET /api/logs?file=bridge|extension|helper&n=200` → tailed log lines
- `POST /api/restart` → graceful bridge exit (autostart respawns)
- `POST /api/reload-extension[?browserId=...]` → broadcast or targeted extension reload via WS

CORS is enabled on GET endpoints for `chrome-extension://` / `moz-extension://` origins so the side panel can use the bridge's `/api/state` as its source of truth instead of the slow native-messaging helper.

**Liveness model:** browser `liveness` is derived from `browserLastSeen` (updated on EVERY inbound WS frame). 'live' = heard within 45s, 'stale' = no inbound frames for >45s (SW likely wedged). The bridge runs a periodic liveness sweep every 15s: ping every connected browser, force-close any that don't pong within 3s. This is the recovery mechanism for MV3 SW eviction.

## Debugging via structured logs (v0.5.6+)

**All three components write NDJSON logs to `%LOCALAPPDATA%\agenthub\logs\`:**
- `bridge.log` — MCP handling, WS lifecycle, tool routing, lifecycle/crash events
- `extension.log` — SW lifecycle, WS, helper calls, tool dispatch (forwarded from extension via WS, written by bridge)
- `helper.log` — every native-messaging invocation (action + result)
- Each rotates at 1 MB, keeps 5 generations (`.log` + `.log.1..4`)

**For any "thing isn't working" question — read the logs BEFORE asking the user:**
```powershell
Get-Content "$env:LOCALAPPDATA\agenthub\logs\bridge.log" -Tail 100
Get-Content "$env:LOCALAPPDATA\agenthub\logs\extension.log" -Tail 100
Get-Content "$env:LOCALAPPDATA\agenthub\logs\helper.log" -Tail 50
```

**Correlation IDs to grep:** `mcpId`, `clientId`, `browserBoundId`, `browserId`, `requestId`, `toolName`. One MCP tool call produces this chain across the three files:
```
bridge.log:    bridge.mcp.tools_call.received  (mcpId, clientId, toolName)
bridge.log:    bridge.tool_request.sent        (mcpId, browserBoundId, browserId)
extension.log: ext.tool_request.received       (requestId, tool)        # requestId == browserBoundId
extension.log: ext.tool.dispatch.start/complete
bridge.log:    bridge.tool_response.received   (mcpId, browserBoundId, durationMs)
bridge.log:    bridge.mcp.tools_call.replied   (mcpId, clientId, isError)
```

If a step is missing, that's where the failure is. Full reference + 5 common debug recipes: `docs/structured-logging.md`.

**Redaction is always on:** URLs collapse to scheme+host, page text becomes `[len=N]`, secrets become `[REDACTED-SECRET]`. Safe to share log snippets — they contain event shapes + IDs, not page content or credentials.

**Privacy off-switch:** drop `{"enabled": false}` at `%LOCALAPPDATA%\agenthub\logs-config.json` and restart the bridge. Honored by bridge, helper, AND extension (eagerly wipes the ring buffer).

**Adding new log events:** import `{ bridgeLog }` in service.ts, `{ logRecord, logError }` in extension modules, or `{ logRecord }` in helper. Use kebab-case `bridge.<area>.<event>` / `ext.<area>.<event>` / `helper.<area>.<event>`. NEVER log raw user/page content — pass through `redact()` from the shared redaction module if you're unsure.

## Common Pitfalls

- Native messaging host registration requires Chrome restart to take effect
- `allowed_origins` in native messaging manifests must include the actual extension ID, not empty string
- Multiple native host processes can run on different ports — always check the lock file for the current one
- The `.cmd` wrapper is needed on Windows because Chrome native messaging requires an executable, not a `.cjs` file
- `DEFAULT_EXTENSION_ID` in `packages/installer/src/shared/constants.ts` is empty — must be provided via flag during install
- Google Chrome stable (138+) AND Chrome Dev (151+) silently ignore `--load-extension` and `--disable-extensions-except`. Only Playwright's bundled Chromium and Microsoft Edge still accept them reliably. See `docs/test-findings.md` §4 and `docs/session-2026-06-08-mcp-fix-and-public-releases.md` §9.
- Extension ID for unpacked `dist/chrome-mv3` is path-derived (SHA256 of UTF-8 absolute path → first 16 bytes → 'a'..'p' encoding). It varies by machine. Tests that need the ID should derive it from the path, not hardcode.

## Release pipeline (two GitHub repos)

Customer-facing installer downloads go through a SEPARATE public repo:

- **Source repo (this one):** `irmasemma/AIBrowserCopilot` — private, holds all source, tests, internal docs.
- **Release-assets repo:** `irmasemma/agenthub-releases` — public, holds ONLY compiled binaries attached to release tags. No source.

`packages/installer/src/shared/constants.ts` sets `GITHUB_REPO = 'irmasemma/agenthub-releases'`. The installer downloads from `https://github.com/irmasemma/agenthub-releases/releases/latest/download/<asset>` — this URL pattern only works anonymously on public repos.

CI workflow (`.github/workflows/release.yml`) dual-publishes on every `v*` tag:
1. Release in the private source repo (default `GITHUB_TOKEN`, for internal tracking)
2. Release in the public agenthub-releases repo (requires `PAT_RELEASES_PUBLIC` repo secret — a fine-grained PAT with Contents:Write on `irmasemma/agenthub-releases`)

If `PAT_RELEASES_PUBLIC` ever expires, customer downloads break silently (the private release still succeeds; the public one fails). Check with `gh secret list --repo irmasemma/AIBrowserCopilot`.

After every CI release, the new `agenthub-setup` installer must be published to npm separately (`cd packages/installer && npm publish`) — otherwise `npx agenthub-setup@latest` still serves the old version.

## End-to-end install + connect test

`tests/e2e/install-and-connect.spec.ts` exercises the full install → connect → MCP path with the user's real browser profile. Default-on against Edge (because of the Chrome stable block above):

```
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  npx playwright test tests/e2e/install-and-connect.spec.ts
```

`COPILOT_TEST_KILL_CHROME=1` is required (it'll close the user's browser session). Test calls `claude -p` for the chat assertions, so `claude` must be on PATH and logged in. Full details + env-var reference + every gotcha hit while building this: `docs/test-findings.md`.
