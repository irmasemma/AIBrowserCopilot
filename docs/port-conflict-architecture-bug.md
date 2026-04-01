# Port 7483 Conflict — Architecture Bug

**Status:** Open — root cause identified, not yet fixed
**Date:** 2026-03-30
**Severity:** Critical — blocks all MCP tool usage for end users

## Summary

The extension and Claude Code both try to own port 7483. Whichever starts first wins. The loser fails silently. The user sees "Connected" in the extension but Claude can't invoke any tools.

## The Three Competing Processes

1. **Chrome's `connectNative()`** — The extension's background script (`native-messaging.ts`) spawns the `.exe` binary via Chrome's native messaging API. This process starts the WebSocket relay on port 7483 and stays alive as long as Chrome is running.

2. **Claude Code global MCP config** — `~/.claude.json` root `mcpServers` entry points to the `.exe`. When the user asks Claude a question, Claude Code tries to start the `.exe` as its own MCP server. Port 7483 is already taken by #1 → **fails silently**.

3. **Claude Code project MCP config** — `~/.claude.json` project scope (`C:/Dev/1M`) uses `node dist/index.js`. Same problem — port 7483 is taken.

## What the User Sees

```
Extension side panel:  "Connected" ✅   (true — connected to Chrome's native host)
Claude Code MCP list:  "Failed"    ❌   (true — can't start because port is taken)
Claude response:       "I can't see your browser"
```

The extension is connected to a native host that **no AI tool talks to**. Claude's MCP server never started.

## Timeline of Workarounds During Debugging (2026-03-30)

| # | Symptom | Workaround | Root cause |
|---|---------|-----------|------------|
| 1 | `claude mcp list` → "Failed to connect" | Killed PID 13768 (orphaned .exe from previous session) | Orphaned process holding port from prior session |
| 2 | Same failure after kill | Killed PID 13768 again (first kill failed — Windows bash `!` prefix syntax issue) | Same orphan, bash syntax issue |
| 3 | MCP "Connected" but tools return "extension not connected" | Killed PID 45816 (node.js started by project config) | Chrome's `connectNative()` took the port before Claude Code could |
| 4 | .exe running on 7483, ESTABLISHED with Chrome, but Claude still can't use tools | Identified — .exe was spawned by Chrome, not by Claude Code | Claude Code can't start its own instance because Chrome's already has the port |

## Root Cause

The extension's `connectNative()` spawns its own native host binary, which grabs port 7483. Then when Claude Code tries to start the same binary as an MCP server, it gets `EADDRINUSE` and fails.

**The native host can only have ONE instance.** Whoever starts it first owns the port. The other fails.

## Correct Architecture

```
CURRENT (broken):
  Chrome extension → connectNative() → spawns .exe → owns port 7483
  Claude Code → tries to start .exe → EADDRINUSE → fails
  Extension shows "Connected" but Claude can't use tools

CORRECT:
  Claude Code (or Claude Desktop, VS Code, etc.) → starts native host → owns port 7483
  Chrome extension → connects to ws://127.0.0.1:7483 as WebSocket client only
  Extension shows "Connected" AND Claude can invoke tools through the same process
```

## Proposed Fix

1. **Remove `connectNative()` from extension background** — The extension should NOT spawn the native host. It should only be a WebSocket client connecting to port 7483.

2. **Extension connects to relay only** — The relay-client.ts already does this. The native-messaging.ts module that calls `connectNative()` should be removed or made optional (fallback only if no WebSocket server is detected).

3. **AI tool manages native host lifecycle** — Claude Code, Claude Desktop, VS Code, etc. start the native host via their MCP config. The extension just connects to it.

4. **Startup flow:**
   - User opens Chrome → extension tries `ws://127.0.0.1:7483`
   - If no server → shows "Setup Required" or "Waiting for AI tool"
   - User opens Claude Code → Claude Code starts native host → port 7483 ready
   - Extension auto-connects → shows "Connected"
   - Both Claude and extension talk to the SAME native host process

## Partial Fixes Already Applied (this session)

- **EADDRINUSE resilience** — Native host relay now probes orphaned ports and retries (`extension-relay.ts`)
- **Heartbeat ping/pong** — Extension verifies connection is alive every 15s, marks disconnected if no response
- **Server info on connect** — Native host sends PID to extension so diagnostics show which process it's connected to
- **Diagnostic panel** — Click status badge in side panel to see port, PID, last tool call, errors
- **Removed global MCP config duplicate** — Eliminated one source of conflict in `~/.claude.json`

## Files Involved

- `packages/extension/src/background/native-messaging.ts` — spawns native host via `connectNative()` (THE PROBLEM)
- `packages/extension/src/background/relay-client.ts` — WebSocket client to port 7483 (correct approach)
- `packages/native-host/src/extension-relay.ts` — WebSocket server on port 7483
- `packages/native-host/src/index.ts` — native host entry point
- `~/.claude.json` — MCP server configs (global + project scope)
