# Bridge architecture — how the pieces talk

Short reference for explaining what the AgentHub bridge is, why it exists,
and the connection failure modes that recur in production. Written
2026-06-09 alongside debugging session §21 follow-up.

## What the bridge is

A single Node.js process (compiled to `agenthub-win-x64.exe`) that runs on
the user's machine and translates between two protocols:

- **MCP (stdio JSON-RPC)** — what Copilot / Claude / Cursor / Windsurf speak
- **WebSocket** — what the Chrome extension can speak

From the MCP client's perspective, the bridge **IS** the MCP server.
Clients spawn `agenthub-win-x64.exe` via stdio and never know there's a
Chrome extension behind it.

## Why it exists

MCP clients cannot talk directly to a Chrome extension. Chrome extensions
cannot accept stdio connections from arbitrary processes. Something in
the middle has to translate. That's the bridge.

```
┌──────────────┐    stdio    ┌────────┐    WebSocket    ┌─────────────┐    Chrome    ┌──────────┐
│ Copilot / VS │  JSON-RPC   │ Bridge │  ws://127:7483  │  Extension  │     APIs     │  Your    │
│ Code / Claude├────────────▶│  .exe  ├────────────────▶│ service     ├─────────────▶│  tabs /  │
│  / Cursor    │             │ (MCP   │                 │  worker     │              │  pages   │
└──────────────┘             │ server)│                 └─────────────┘              └──────────┘
                             └────────┘                        ▲
                                  │   server_ping every 20s    │
                                  └────────────────────────────┘
                                      (keep-alive heartbeat)
```

### Why single binary, not separate processes

The bridge is one `.exe` that uses port-detection to decide what to be:

- **First instance to win port 7483** = primary server. Holds the
  WebSocket map, routes between MCP clients and extensions.
- **Every subsequent instance** = secondary. Detects port is taken,
  connects as WS client with `?role=mcp`, proxies stdio ↔ WS to the
  primary.

This means VS Code, Cursor, Claude can each spawn the binary
independently and they all end up talking through the same primary
without coordination.

## How a tool call flows end-to-end

```
1. User in Copilot:      "screenshot my current tab"
                              │
2. Copilot MCP client:   tools/call { name: "take_screenshot", args: {tab_id: "..."} }
                              │ (stdio)
                              ▼
3. Bridge (PID 33904,   forwards via ws://127:7483?role=mcp
   secondary instance)        │
                              ▼
4. Bridge (PID 16196,   receives tools/call, looks up routing,
   primary):            sends `tool_request` over WebSocket
                              │
                              ▼
5. Chrome extension SW: receives WS message, runs chrome.tabs.captureVisibleTab
                              │
                              ▼
6. Extension SW:        sends `tool_response` back over WS
                              │
7. Bridge:              translates to MCP result envelope
                              │
                              ▼
8. Copilot:             renders the screenshot
```

Every step has its own failure mode. The bridge sits in the middle of
all of them and is the only component that can see end-to-end. Hence the
need for good error translation (§21 fix added 2026-06-08) and good
liveness detection (still incomplete).

## Why we end up with "Chrome: timeout"

Chrome MV3 changed extensions in 2023: the persistent background page
was removed. Service workers (SWs) replaced it. SWs auto-evict after
30 seconds of inactivity. The eviction can put the WS into a zombie
state:

```
   ┌─────────────────┐
   │  Extension SW   │  ← JS handler runs, replies normally
   │  is ALIVE       │
   └────────┬────────┘
            │
            ▼ idle 30s, no incoming messages
   ┌─────────────────┐
   │  Chrome evicts  │  ← JS engine torn down
   │  the SW         │
   └────────┬────────┘
            │
            ▼ but the OS-level WS connection STAYS OPEN
   ┌─────────────────┐
   │  netstat says   │  ← ESTABLISHED, looks healthy
   │  ESTABLISHED    │
   └────────┬────────┘
            │
   Bridge: "Chrome is connected (I see the WS)"  ← LIE
            │
   Client calls take_screenshot
            │
            ▼ Bridge sends tool_request via WS
            ▼ Message reaches the OS socket
            ▼ No JS handler runs to read it
            ▼ 2-second per-browser timeout (FAN_OUT_TIMEOUT_MS) fires
            │
   Bridge returns: "Chrome: timeout"
   Client renders: "no browser extension connected"
```

The bridge **trusts the OS view** (WS is ESTABLISHED) instead of
**asking the SW to prove it's alive**. That's the architectural gap.

## What partial fixes exist

Two mitigations are already in the codebase:

### 1. `server_ping` heartbeat (bridge → SW)

The bridge sends `{ type: "server_ping" }` to every connected extension
every 20 seconds (`SERVER_PING_INTERVAL_MS` in `service.ts:260`). Each
message resets Chrome's SW eviction timer because the WS `onmessage`
event counts as SW activity.

**What it covers:** SWs that are dozing (would have evicted) stay alive.

**What it doesn't cover:** SWs that are already dead. The ping arrives at
the dead OS socket but no JS runs to be "activity."

### 2. `panel-keepalive` port (side panel ↔ SW)

When the side panel is open, it opens a `chrome.runtime.connect` port to
the background SW. Port activity counts as SW liveness. Implemented in
`background.ts:139-146`.

**What it covers:** SW stays alive while the user has the side panel open.

**What it doesn't cover:** Side panel closed → no keepalive → SW may evict
after 30s.

## Why "Reload extension" + "Restart" don't always fix it

When the user clicks the side-panel button:

1. `chrome.runtime.reload()` kills the SW, the side panel, content scripts
2. Chrome SHOULD relaunch the SW. It often doesn't until something
   triggers it (next `chrome.alarms` fire at up to 30s, or user reopens
   the side panel).
3. When the SW eventually relaunches, it reconnects to the bridge with
   the SAME `browserId` (the per-install UUID is in `chrome.storage.local`
   which `reload()` does not clear).
4. The bridge's `indexBrowser()` (`service.ts:168-185`) sees the existing
   socket and calls `existing.terminate()`. SHOULD work, but if the
   underlying TCP was zombied, terminate doesn't always wake the bridge's
   internal state machine.
5. For fan-out tools like `list_tabs`, the bridge iterates BOTH the stale
   socket and the new one until the stale one cleans up. The stale one
   times out at 2 seconds; the new one replies.

**Net effect:** "Reload" sometimes shows a 5–30 second window where
things look broken before stabilizing. Users assume it didn't help.

## Why MCP clients can't recover on their own

There's no signal to the client that the extension is sick. The bridge
keeps the dead WS in its `browserSockets` map. Tool calls get a
`timeout` error, which from the client's perspective looks like a
transient hiccup. The client retries → timeout again → gives up and
reports "no browser extension connected" (technically wrong; the WS
is there, the extension's JS engine just isn't).

## Why the SW can be completely dead (even with side panel open + restart)

Several scenarios that all leave the SW in "Inactive" state in
chrome://extensions/:

1. **`chrome.runtime.reload()` race.** Restart kills SW + side panel.
   New side panel reopens → tries to open the keepalive port → SW hasn't
   started yet → port open fails silently → SW never wakes.
2. **Crashed SW.** If the SW threw an uncaught exception during startup
   (e.g. while reconnecting WebSocket), Chrome may not auto-restart it.
   It stays "Inactive" until something triggers it.
3. **Chrome blocking SW spawn.** Memory pressure, per-profile resource
   limits, or "extension throttling" (Chrome 116+) can refuse to launch
   a SW.
4. **WebSocket reconnect storm.** SW spawns, tries to connect to bridge,
   bridge rejects (e.g. origin allowlist mismatch from
   extension-ids.json), SW retries, hits backoff. Looks "alive" but is
   not doing useful work.
5. **Force-kill side effects.** If the bridge was killed with
   `taskkill /F`, the WS may have been left in a state Chrome's MV3
   stack doesn't gracefully recover from.

**How to confirm:** Open
`chrome://extensions/?id=<extension-id>` and look at the "service worker"
link.

- Link reads "(Inactive)" → SW is dead. Clicking the link forces it awake.
- Errors badge visible → click for stack trace.
- No badge, link says "service worker" with timestamp → SW is alive
  (problem is elsewhere — check bridge log or netstat).

## The real fix (not yet implemented)

What's missing on the bridge side:

```
Bridge sends server_ping → starts a 2-second response timer
If server_pong arrives → reset miss counter, all good
If 3 consecutive misses → mark this WS as dead:
    - call unindexBrowser(browserId)
    - close the WS
    - emit a structured event clients can subscribe to
```

After this:

- `connectedBrowsers` in `server_info` accurately reflects reality
- Tool calls get `no browser extension connected` (recoverable error
  clients understand) instead of `timeout` (looks transient)
- The dead-SW window collapses from "until something else triggers
  cleanup" to "60 seconds maximum"

The MV3 ecosystem will not give us a better answer than this. Chrome
won't restore persistent backgrounds. The bridge has to assume the
extension is unreliable and verify liveness itself.

## Related fixes already shipped

- **§21 envelope translation** (commit `b7c0c6b`, 2026-06-08): the bridge
  now translates extension error envelopes into proper MCP `isError`
  results so failures surface readably instead of silently empty. See
  `docs/session-2026-06-08-mcp-fix-and-public-releases.md`.
- **Multi-profile fan-out** (commit `4ee5e28`, 2026-05-09): added the
  per-install UUID + `server_ping` keepalive + side-panel keepalive port.
  See `docs/multi-profile-tab-fanout-design.md`.

## Quick reference: file map

| Concern | File |
|---|---|
| Bridge process lifecycle, port detection | `packages/native-host/src/index.ts` |
| WS server, MCP handler, routing | `packages/native-host/src/service.ts` |
| Lock-file management | `packages/native-host/src/lock-file-manager.ts` |
| Extension SW, WS client | `packages/extension/src/background/relay-client.ts` |
| Extension keepalive logic | `packages/extension/src/background/heartbeat-monitor.ts` |
| Side-panel keepalive port | `packages/extension/src/entrypoints/background.ts:139-146` |
| Helper for service status / diagnostics | `packages/native-host-helper/src/service-status.ts` |
| **Structured logs** (`%LOCALAPPDATA%\agenthub\logs\`) | `packages/native-host/src/shared/logger.ts` + `redaction.ts` |
| Bridge log emission | `packages/native-host/src/service.ts` (`bridgeLog()` calls) |
| Extension log emission + flush | `packages/extension/src/shared/logger.ts` |
| Helper log emission | `packages/native-host-helper/src/logger.ts` |

## Debugging from logs (v0.5.6+)

If the bridge or extension misbehaves, **read the logs first**. They reconstruct the full chain with correlation IDs without needing DevTools or a screen recording. See `docs/structured-logging.md` for the file layout, NDJSON shape, redaction rules, and step-by-step recipes for the 5 most common failure modes (MCP timeout, disconnected-but-alive, service won't start, wrong profile got the call, SW alive but unresponsive).
