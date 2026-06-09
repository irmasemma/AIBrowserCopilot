# Structured logging

**Audience:** LLMs (Claude, Copilot, GPT) running on a user's Windows machine, asked to debug "why isn't MCP/the bridge working?" without DevTools access.

**Promise:** Every meaningful event in the bridge ↔ extension ↔ helper ↔ MCP client chain is written as a single NDJSON line to a file under `%LOCALAPPDATA%\agenthub\logs\`. `grep -rn '<mcpId>' %LOCALAPPDATA%\agenthub\logs\*.log` reveals the full call chain across all three components.

## File layout

```
%LOCALAPPDATA%\agenthub\
  ├─ server.lock                   ← bridge PID/port (existing)
  ├─ logs-config.json              ← OPTIONAL privacy toggle
  ├─ bridge.log.legacy             ← migrated pre-0.5.6 log (one-time)
  └─ logs\
      ├─ bridge.log                ← current bridge events
      ├─ bridge.log.1..4           ← rotated (oldest dropped)
      ├─ extension.log             ← extension events (forwarded via WS)
      ├─ extension.log.1..4
      ├─ helper.log                ← native-messaging helper invocations
      └─ helper.log.1..4
```

## NDJSON line shape

```json
{"t":"2026-06-09T14:30:12.345Z","src":"bridge","lvl":"info","pid":16196,"event":"bridge.mcp.tools_call.received","mcpId":1,"clientId":"a1b2","toolName":"take_screenshot"}
```

Required fields: `t`, `src` (`bridge|ext|helper`), `lvl` (`info|warn|error`), `pid` (`null` for ext), `event` (kebab-case).

## Correlation IDs

| Field | Purpose |
|---|---|
| `mcpId` | JSON-RPC message id from the MCP client |
| `clientId` | Bridge-assigned UUID per MCP client connection |
| `browserBoundId` | Bridge-assigned `b_<uuid>` per outgoing tool_request (= extension's `requestId`) |
| `browserId` | Composite `chrome:<uuid>` of the routed extension |
| `toolName` | E.g. `take_screenshot`, `click`, `list_tabs` |
| `durationMs` | Set on completion events |

The chain for one tool call:

```
bridge.log:  bridge.mcp.tools_call.received  (mcpId, clientId, toolName)
bridge.log:  bridge.tool_request.sent        (mcpId, browserBoundId, browserId, toolName)
extension.log: ext.tool_request.received     (requestId, tool)
extension.log: ext.tool.dispatch.start       (toolName, activityId)
extension.log: ext.tool.dispatch.complete    (toolName, durationMs)
bridge.log:  bridge.tool_response.received   (mcpId, browserBoundId, durationMs)
bridge.log:  bridge.mcp.tools_call.replied   (mcpId, clientId, toolName, durationMs, isError)
```

If any step is missing, that's where the failure is.

## Rotation

- Threshold: **1 MB** per file
- Keep: **5 generations** (`.log` + `.log.1`..`.log.4`)
- Strategy: open/write/close per call (no held handle — needed for Windows rename)
- EPERM/EBUSY on rotate: skip cycle, retry next write

## Redaction (always on)

| Pattern | What it becomes |
|---|---|
| Field named `url`, `href`, `targetUrl`, … | `https://example.com/[redacted]` (scheme + host kept) |
| Field named `value`, `text`, `body`, `content`, `snapshot`, … | `[len=N]` |
| Field named `cookie`, `token`, `apiKey`, `password`, … | `[REDACTED-SECRET]` (no length leak) |
| String > 200 chars | `[len=N]` |
| JWT-shaped string | `[REDACTED-JWT]` |
| URL inside a longer string (error messages, stack traces) | URL portion replaced; rest preserved |

Errors are normalized: `errorName` + redacted `errorMessage` + 20-line stack with embedded URLs redacted.

The bridge **never** logs full page text, form values, cookies, headers, or user credentials. The "what" (event name + IDs) is preserved; the "what was IN it" is not.

## Privacy toggle

Drop a file at `%LOCALAPPDATA%\agenthub\logs-config.json`:

```json
{ "enabled": false }
```

Effect:
- Bridge: writes nothing to `bridge.log` or `extension.log`
- Helper: writes nothing to `helper.log`
- Extension: stops buffering in-memory; existing buffer is wiped

Change requires restarting the bridge for new connections. The default (file absent) is **enabled = true** — the goal of this work is debuggability, so opt-in privacy.

## How a future LLM debugs from logs

1. **"MCP timed out"** — search bridge.log for `bridge.tool_request.timed_out`. Check if `bridge.tool_response.received` ever fired with the same `browserBoundId`. If not: extension dropped it. Look in `extension.log` for `ext.tool_request.received` with that `requestId` — present means SW got it, dispatch failed; absent means SW didn't get it (WS dead or SW evicted).

2. **"Extension shows disconnected but bridge alive"** — search bridge.log for `bridge.browser.disconnected`. Compare against extension.log `ext.ws.close`. If close codes disagree, the SW thinks it's connected but the bridge dropped it (heartbeat path).

3. **"Service won't start"** — helper.log shows `helper.invoke.received action=start_native_host` followed by `.replied ok=false errorMessage=...`. Reason is right there.

4. **"Wrong browser profile got the tool call"** — bridge.log `bridge.mcp.tools_call.received` has `routeSource` (`tab_id_prefix | explicit_browser_param | default`) and `targetBrowserId`. Compare against `bridge.browser.connected` entries to see what was registered when.

5. **"SW was alive but unresponsive"** — extension.log will have an `ext.heartbeat.miss` followed by `ext.heartbeat.dead`. Bridge.log will show `bridge.tool_request.timed_out` around the same time. If only bridge logs and no extension logs at all, SW was completely dead (no chance to flush — see `bridge-architecture.md` for the SW liveness failure modes).

## What's NOT logged

- Page content (intentional — see redaction)
- Tab focus / window changes (irrelevant to MCP debugging)
- `server_ping` / `server_pong` heartbeats (would dominate the file)
- `chrome.runtime.lastError` strings that didn't lead to a real failure
- SW startup-side errors that fire before the ring buffer becomes available (those still live only in `chrome://extensions/` Errors)

## What `%LOCALAPPDATA%\agenthub\logs\` looks like under load

A typical 5-minute tool-heavy session: ~200 KB of bridge.log, ~150 KB of extension.log, ~20 KB of helper.log. Well under the 1 MB rotation threshold. Heavy users (continuous agent runs over hours) hit rotation; we keep the last 5 MB.
