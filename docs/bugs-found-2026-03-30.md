# Bugs Found & Fixed — 2026-03-30

## Bug 1: Port 7483 Conflict (CRITICAL)

**Symptom:** Extension shows "Connected" but Claude Code says "Failed to connect" or "extension not connected" when invoking tools.

**Root cause:** The extension's `connectNative()` spawned the native host binary via Chrome's native messaging API, grabbing port 7483. When Claude Code tried to start the same binary as its MCP server, it got `EADDRINUSE` and failed silently. The extension was connected to a process that Claude didn't know about.

**Fix:** Removed `connectNative()` from the extension background script. The extension is now a pure WebSocket client — it never starts the native host. The AI tool (Claude Code, VS Code, etc.) manages the native host lifecycle. Extension connects to whatever is on port 7483.

**Files changed:**
- `packages/extension/src/entrypoints/background.ts` — removed connectNative calls
- `packages/extension/src/background/native-messaging.ts` — gutted to no-ops
- `packages/extension/src/background/relay-client.ts` — rewritten reconnect logic

---

## Bug 2: Extension Gives Up After 3 Reconnect Failures (HIGH)

**Symptom:** If no AI tool is running when Chrome starts, extension tries to connect 3 times then permanently shows "Setup Required" — even if the user starts Claude Code later. Only fix was reloading the extension.

**Root cause:** `MAX_RECONNECT_ATTEMPTS = 3` in relay-client.ts. After 3 failures, the extension transitioned to `'setup-needed'` state and stopped trying.

**Fix:** Removed the give-up limit. Extension now polls indefinitely with exponential backoff (1s → 1.5s → 2.25s → ... capped at 10s). Added new `'waiting'` connection state that clearly tells users: "Start Claude Code, VS Code, or another MCP host to connect."

**Files changed:**
- `packages/extension/src/background/relay-client.ts` — removed MAX_RECONNECT_ATTEMPTS, added backoff
- `packages/extension/src/shared/types.ts` — added 'waiting' to ConnectionState
- `packages/extension/src/sidepanel/components/status-badge.tsx` — added 'waiting' visual state

---

## Bug 3: "Reconnect" Button Was Broken (MEDIUM)

**Symptom:** Clicking the "Reconnect" button in the error card did nothing.

**Root cause:** The error card sent message type `'reconnect'` but the background script only handled `'retry_connection'`. The message was silently ignored.

**Fix:** Background script now handles both `'retry_connection'` and `'reconnect'` message types. Also changed the error card to use `'retry_connection'` for consistency.

**Files changed:**
- `packages/extension/src/entrypoints/background.ts` — handles both message types
- `packages/extension/src/entrypoints/sidepanel/main.tsx` — changed to 'retry_connection'

---

## Bug 4: Missing `scripting` Permission (CRITICAL)

**Symptom:** `Cannot read properties of undefined (reading 'executeScript')` error when MCP tools tried to run content scripts. Intermittent — sometimes worked, sometimes didn't.

**Root cause:** The manifest declared `activeTab` but not `scripting`. `activeTab` only grants temporary scripting access after a user gesture (click). When the AI tool invokes tools programmatically (no user gesture), `chrome.scripting` was undefined — especially after service worker restart.

**Fix:** Added `scripting` to the permissions array in `wxt.config.ts`.

**Files changed:**
- `packages/extension/wxt.config.ts` — added 'scripting' permission
- `docs/store-listing.md` — added permissions justification for 'scripting'

---

## Bug 5: No Connection Diagnostics (LOW)

**Symptom:** No way to tell what process the extension was connected to, whether tools were actually flowing, or why things weren't working. Required manual `netstat` and `tasklist` commands to debug.

**Fix:** Added diagnostic info to connection state: relay port, server PID, last tool call timestamp. Click the status badge in the side panel to see diagnostics. Native host now sends `server_info` (including its PID) when the extension connects. Extension sends heartbeat ping every 15s — if no pong within 5s, marks as disconnected.

**Files changed:**
- `packages/extension/src/shared/types.ts` — added relayPort, serverPid, lastToolCall to ConnectionInfo
- `packages/extension/src/background/relay-client.ts` — heartbeat + server_info handling
- `packages/extension/src/sidepanel/components/connection-header.tsx` — click-to-expand diagnostics
- `packages/native-host/src/extension-relay.ts` — sends server_info, handles ping/pong

---

## Bug 6: Dual MCP Config Conflict (MEDIUM)

**Symptom:** Claude Code's `~/.claude.json` had the MCP server defined in both global scope AND project scope (`C:/Dev/1M`). The global one pointed to the `.exe` binary, the project one to `node dist/index.js`. Both tried to start, causing port conflicts.

**Root cause:** The installer wrote the global config (correct for customers), and a manual project-scoped config was added during development. They competed for port 7483.

**Fix:** Removed the manual project config. Running the installer (`npx ai-browser-copilot-setup --yes`) correctly configures the global MCP entry. This is the same path customers follow.

**Lesson:** Never manually edit `.claude.json` for MCP config — always use the installer.

---

## Bug 7: EADDRINUSE Not Handled Gracefully (MEDIUM)

**Symptom:** If an orphaned native host process holds port 7483, the new instance crashes with `EADDRINUSE` and Claude Code reports "Failed to connect."

**Root cause:** No error handling for port-in-use scenario in `extension-relay.ts`.

**Fix:** Added EADDRINUSE resilience: when the port is taken, the relay probes the existing server. If it's alive (another instance), exits gracefully. If it's a dead/orphaned process, retries after 500ms.

**Files changed:**
- `packages/native-host/src/extension-relay.ts` — EADDRINUSE detection and retry

---

## Bug 8: Installer Fails on Locked Binary (LOW)

**Symptom:** `EPERM: operation not permitted, rename` when running the installer while the native host binary is running.

**Root cause:** Windows locks running executables. The installer downloads to `.tmp` then tries atomic rename, which fails because the target `.exe` is in use.

**Status:** Not fixed yet. Workaround: close Chrome or kill the native host process before running the installer with `--update`. Future fix: installer should detect running processes and ask user to close them.

---

## Bug 9: MCP Tool Descriptions Too Technical (LOW)

**Symptom:** Claude didn't invoke MCP tools from natural language prompts like "what's on my tab?" — it would respond conversationally instead of using the tools.

**Root cause:** Tool descriptions were terse and technical (e.g. "Extract text or HTML content from the active browser tab"). Claude didn't recognize them as matching natural user requests.

**Fix:** Rewrote all 8 tool descriptions to include natural language triggers. Example: "Read the text or HTML content of the web page the user is currently viewing in their browser. Use this when the user asks about what is on their screen, current tab, or current page."

**Files changed:**
- `packages/native-host/src/tools/*.ts` — all 8 tool description fields updated

---

## Bug 10: `undefined` Args Crash executeScript (HIGH)

**Symptom:** `Error in invocation of scripting.executeScript: Value is unserializable` when clicking elements, extracting tables, or any tool with optional params.

**Root cause:** `chrome.scripting.executeScript({ args: [...] })` requires all values to be JSON-serializable. `undefined` is not JSON-serializable. Tools like `click_element` passed `args: [selector, text]` where one could be `undefined`.

**Fix:** Changed all optional params from `undefined` to `null` using `?? null` coercion. Applied to `click_element` (selector, text), `extract_table` (selector), and `list_tabs` (query).

**Files changed:**
- `packages/extension/src/background/tool-dispatcher.ts` — coerce undefined to null for all executeScript args

---

## Bug 11: Missing `host_permissions` for All URLs (CRITICAL)

**Symptom:** `Extension manifest must request permission to access this host` when MCP tools tried to read any website.

**Root cause:** Manifest only had `activeTab` permission, which grants access only on user click (gesture). MCP tool calls are programmatic — no user gesture — so Chrome blocked access to all sites.

**Fix:** Added `host_permissions: ['<all_urls>']` to manifest and removed redundant `activeTab`. Updated store listing with justification for CWS review.

**Files changed:**
- `packages/extension/wxt.config.ts` — added host_permissions, removed activeTab
- `docs/store-listing.md` — added host_permissions justification

---

## Summary

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 1 | Port 7483 conflict (connectNative) | Critical | Fixed |
| 2 | Give up after 3 reconnect failures | High | Fixed |
| 3 | Reconnect button sends wrong message | Medium | Fixed |
| 4 | Missing `scripting` permission | Critical | Fixed |
| 5 | No connection diagnostics | Low | Fixed |
| 6 | Dual MCP config conflict | Medium | Fixed |
| 7 | EADDRINUSE not handled | Medium | Fixed |
| 8 | Installer fails on locked binary | Low | Not fixed (workaround exists) |
| 9 | Tool descriptions too technical | Low | Fixed |
| 10 | undefined args crash executeScript | High | Fixed |
| 11 | Missing host_permissions for all URLs | Critical | Fixed |
