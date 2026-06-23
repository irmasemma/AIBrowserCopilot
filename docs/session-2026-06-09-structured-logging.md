# Session 2026-06-09 — Structured logging foundation (v0.5.6)

**TL;DR:** Added comprehensive structured NDJSON logging across bridge / extension / helper so any future LLM session on a user's machine can grep `%LOCALAPPDATA%\agenthub\logs\*.log` and reconstruct the full MCP → bridge → extension → tool chain. Stops the "please screenshot DevTools" rounds with users.

**Ships as:** v0.5.6 (commit `b115b0e`, tag `v0.5.6`, both releases published).

## Why this exists

Recurring pain (called out in the prior session and again at the start of this one):

1. User: "MCP says disconnected." We had no way to know whether bridge died, SW wedged, or both — only what the side-panel UI chose to show, which itself is often stale.
2. SW wedging: OS-level WS stays ESTABLISHED but JS engine isn't processing. From the bridge's perspective the connection is fine; from Chrome's perspective the SW is asleep. Two different views of the same dead channel.
3. Every debug session required asking the user to open DevTools, screenshot console, paste error messages, restart Chrome, repeat. Slow + frustrating + lossy.

User asked: *"Let's first add logs for all parts of our extension, so each LLM on the machine will be able to get full picture. Is that possible?"* — that's what this is.

## What ships

### 1. Shared logger module (`packages/native-host/src/shared/logger.ts`)
- NDJSON, one line per record, single file per source
- 1 MB rotation threshold, 5 generations kept
- Open / write / close per call — required for Windows rename-during-rotation (held handles block renames)
- In-memory byte counter (no `statSync` per write)
- EPERM/EBUSY on rotate → skip cycle, retry next write (handles tail -F / antivirus / indexer holding the file)
- 16 KB single-line cap (oversize records become `{_truncated: true, _originalBytes}` markers)
- Reads `<installDir>/logs-config.json` once per process for the privacy toggle
- **Never throws** — a broken logger crashing the bridge is worse than no logger

### 2. Shared redaction module (`packages/native-host/src/shared/redaction.ts`)
Two-layer redaction, applied before serialization:
- **Key-based:** field names in URL_KEYS (`url`, `href`, `targetUrl`, ...) → `<scheme>://<host>/[redacted]`. TEXT_KEYS (`value`, `text`, `body`, `snapshot`, ...) → `[len=N]`. SECRET_KEYS (`cookie`, `token`, `password`, ...) → `[REDACTED-SECRET]` (no length leak). RECORD_ARRAY_KEYS → `{arrayLen: N, sampleKeys: [...]}`.
- **Shape-based:** anything > 200 chars → `[len=N]`. JWT-pattern → `[REDACTED-JWT]`. URLs embedded inside error messages or stacks get the URL portion replaced in-place (preserves debuggability of the surrounding text).

`fields` is NOT in RECORD_ARRAY_KEYS — we want per-entry redaction so fill_form debug shows which field names and value lengths were attempted.

Errors normalized via `redactError(err)` → `{errorName, errorMessage (redacted), stack (URLs in stack frames redacted, capped at 20 lines), errorCode}`.

### 3. Bridge instrumentation (`packages/native-host/src/service.ts`)
Every meaningful event now logs with correlation IDs:
- MCP path: `bridge.mcp.tools_call.received` → `bridge.tool_request.sent` → `bridge.tool_response.received` → `bridge.mcp.tools_call.replied`. Carries `mcpId`, `clientId`, `browserBoundId`, `browserId`, `toolName`, `durationMs`, `isError`, `contentItems`.
- Lifecycle: `bridge.lifecycle.start` (with port/version/buildId/startedBy), `.uncaught`, `.unhandled_rejection`, `.lock_file_write_failed`.
- WS: `bridge.ws.upgrade_accepted/rejected`, `bridge.browser.connected/disconnected`, `bridge.mcp.client_connected/disconnected`.
- Fanout: `bridge.fanout.started/aggregated/failed`.
- Discovery/routing: `bridge.route.no_browser`, `bridge.tool_request.timed_out`, `bridge.tool_request.failed`.
- `log_batch` ingest: validates entries, caps at 200/batch, writes to `extension.log` stamped with `_via_bridge_pid` for cross-generation tracking.

Replaced ALL `process.stderr.write` + the old free-text `appendBridgeLog` calls with structured `bridgeLog()` calls.

### 4. Extension instrumentation
Ring buffer in `chrome.storage.local` (key `__agenthub_log_buffer`), max 500 entries, FIFO drop-oldest.

Critical design constraints baked in:
- **Serialized writes** via a single promise queue — without this, concurrent `logRecord()` calls race on the storage RMW (each reads same buffer, appends one, writes back → last writer wins, others lost). With the queue, all 50 concurrent writes survive (tested).
- **Send returns bool** — `flushPending(send)` calls `send` which now returns `true` when WS is open and the frame was queued, `false` otherwise. On `false`, the buffer is preserved.
- **Only-trim-what-was-sent** — `flushPending` snapshots the buffer length, sends in 100-entry chunks, then re-reads the (possibly grown) buffer and slices off exactly `sentCount` entries. Concurrent writes during the flush survive.
- **Periodic flush** every 10 s while connected — without this, healthy long-running sessions never write their events to `extension.log` until the WS cycles.
- **Privacy: `setLoggingEnabled(false)` eagerly wipes the buffer** — opt-out takes effect immediately, not at next flush.

Instrumented hooks:
- `connection-manager.ts`: `ext.ws.connect.attempt/open/server_info/close/error/server_info_timeout`; `ext.heartbeat.miss/dead`; `ext.tool_request.received`; `ext.log.flushed`
- `service-discovery.ts`: `ext.helper.invoke.start/complete/error` (every native messaging call)
- `tool-dispatcher.ts`: `ext.tool.dispatch.start/complete/error` (every dispatch, with `activityId`)
- `entrypoints/background.ts`: `ext.sw.start`, `ext.tool.send_error`

### 5. Helper instrumentation
Per-invocation logger (helper is short-lived: invoked, replies, exits). Same NDJSON shape, same redaction, same rotation (with `unlinkSync` before `renameSync` to be Windows-safe). Logs `helper.invoke.received/replied/unknown_action/error` for every action with `durationMs`.

### 6. Privacy toggle
Drop `%LOCALAPPDATA%\agenthub\logs-config.json` with `{"enabled": false}`. Bridge / helper / extension ALL honor it:
- Bridge: `logRecord()` no-ops, no file created
- Helper: same
- Extension: `setLoggingEnabled(false)` makes `logRecord()` no-op AND eagerly wipes the persisted buffer

Default = enabled. Fail-open on malformed config (logging stays on; we'd rather have logs than silent privacy that isn't communicated).

### 7. Bridge maxPayload
Set WS `maxPayload: 4 * 1024 * 1024` (4 MiB). Real tool requests max ~200 KB; this gives generous headroom and protects bridge memory from runaway log_batch or malicious page-scraping results.

### 8. Migration of legacy log
Pre-0.5.6 bridge wrote a single-file `<installDir>/bridge.log`. On first startup of v0.5.6, `migrateLegacyBridgeLog()` renames it to `<installDir>/logs/bridge.log.legacy` so users keep the history.

## Tests added (60+ new)

- `packages/native-host/src/shared/logger.test.ts` — 17 tests (rotation, robustness, makeLogger, privacy toggle)
- `packages/native-host/src/shared/redaction.test.ts` — 27 tests
- `packages/extension/src/shared/logger.test.ts` — 26 tests (ring buffer, serialized writes, flush + send-fail-keep-buffer + partial-fail-preserves-remainder, privacy)
- `packages/extension/src/shared/redaction.test.ts` — 27 tests

**Total across all packages: 720 tests pass** (extension 253, native-host 136, helper 20, installer 311).

## Files changed

Modified:
- `packages/native-host/src/service.ts` — comprehensive instrumentation, log_batch handler, migration call, removed all stderr.write/appendBridgeLog
- `packages/native-host/src/version.ts` — bumped to 0.5.6
- `packages/native-host-helper/src/index.ts` — instrumented all action branches
- `packages/native-host-helper/src/version.ts` — bumped to 0.5.6
- `packages/extension/src/background/connection-manager.ts` — WS lifecycle + heartbeat + periodic log-flush timer
- `packages/extension/src/background/service-discovery.ts` — helper invoke logging
- `packages/extension/src/background/tool-dispatcher.ts` — dispatch logging
- `packages/extension/src/entrypoints/background.ts` — SW start log, send_error log
- `packages/extension/wxt.config.ts` — manifest version 0.5.6
- All four `package.json` + root `package.json` — version 0.5.6

New:
- `packages/native-host/src/shared/{logger,redaction}.ts` + tests
- `packages/extension/src/shared/{logger,redaction}.ts` + tests
- `packages/native-host-helper/src/{logger,redaction}.ts`
- `docs/structured-logging.md` — file layout, NDJSON shape, redaction rules, privacy toggle, 5 step-by-step debug recipes
- `docs/session-2026-06-09-structured-logging.md` — this file

Re-built:
- `packages/native-host/bin/agenthub-win-x64.exe` (38 MB)
- `packages/native-host-helper/bin/agenthub-helper-win-x64.exe` (38 MB)

## Critique from rubber-duck — what I adopted

The rubber-duck pass on the implementation flagged these; I adopted them:

1. **Helper privacy gap** — original implementation only honored `logs-config.json` in the bridge. Fixed: helper now reads it too, AND extension uses `setLoggingEnabled(false)` to eagerly wipe its buffer.
2. **Extension RMW race** — concurrent `logRecord()` calls would race on `chrome.storage.local`. Fixed with a serialized promise queue.
3. **Flush losing entries on disconnect** — `flushPending` was clearing the whole buffer regardless of send success. Fixed: send returns bool, only `sentCount` entries get trimmed, fresh buffer is re-read so concurrent writes during the flush survive.
4. **No periodic flush** — extension logs only reached `extension.log` on reconnect. Fixed with a 10s timer started in `onServerInfo` and stopped in `onClose`.
5. **log_batch DoS** — no entry cap. Fixed: 200 entries/batch max, oversize dropped with a warn log; WS `maxPayload` capped at 4 MiB.
6. **Helper Windows rotation** — `renameSync` over an existing target throws EPERM on Windows. Fixed: helper rotation now `unlinkSync` before `renameSync` (matches the bridge's approach).

Set aside (consciously):
- **Extract shared package for redaction** — 3 copies of `redaction.ts` is duplication, but extracting a workspace package would force npm-resolved imports in `bundle.cjs` paths, complicate the build, and the file is stable enough that drift risk is low. Will revisit if we make material redaction changes.
- **End-to-end correlation test** — has value but the unit-tested wiring + first user-facing run will surface any regressions. Deferred to a follow-up.

## What an LLM session debugging a user issue should do (v0.5.6+)

1. Don't ask the user to screenshot DevTools. Read the logs:
   ```powershell
   Get-Content "$env:LOCALAPPDATA\agenthub\logs\bridge.log" -Tail 100
   Get-Content "$env:LOCALAPPDATA\agenthub\logs\extension.log" -Tail 100
   Get-Content "$env:LOCALAPPDATA\agenthub\logs\helper.log" -Tail 50
   ```
2. Grep one ID across all three files to see the full chain:
   ```powershell
   Select-String -Path "$env:LOCALAPPDATA\agenthub\logs\*.log" -Pattern '"mcpId":42'
   ```
3. Reference `docs/structured-logging.md` §"How a future LLM debugs from logs" for the 5 common recipes.

## What's still NOT logged (intentional)

- Full page text / DOM (TEXT_KEYS redacts to `[len=N]`)
- Cookies, headers, credentials, tokens (SECRET_KEYS / shape-based)
- `server_ping` / `server_pong` heartbeats (would dominate the file at one entry per 20s × hours)
- SW startup errors that fire before the ring buffer becomes available (those still live only in `chrome://extensions/` Errors panel — a known gap, but pragmatically the SW's first action is `logRecord({event: 'ext.sw.start'})` so anything that crashes BEFORE that is by definition a load-time problem visible in Chrome's UI anyway)

## Still pending (manual step)

User must run `cd packages/installer && npm publish` to push `agenthub-setup@0.5.6` to npm. Until then `npx agenthub-setup@latest` still serves 0.5.5 binaries (which work; they just don't have the new logs). Customers who upgrade get logging automatically.

## Cross-references

- `docs/structured-logging.md` — operator/LLM-facing reference (recommended reading)
- `docs/bridge-architecture.md` — why the bridge exists, SW liveness failure modes, now includes log-files row in the file map
- `CLAUDE.md` — has a "Debugging via structured logs" section pointing here and at `structured-logging.md`
- `docs/session-2026-06-08-mcp-fix-and-public-releases.md` — prior session; v0.5.5 fix narrative
