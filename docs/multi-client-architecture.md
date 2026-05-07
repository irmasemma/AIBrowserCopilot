# Multi-Client Architecture

**Status:** Implemented on `multi-client-architecture` branch
**Date:** 2026-05-06
**Scope:** native-host, extension

This document describes how multiple MCP clients (Claude Desktop, Claude Code, VS Code, Cursor, …) and multiple browsers (Chrome, Edge, Brave, …) share **one** local relay simultaneously.

---

## 1. Goals

- Any number of MCP clients on one machine — no client kills another.
- Any number of browsers connected — selectable per tool call via `browser` parameter.
- One small binary, no helpers, no IPC sockets, no native messaging discovery.
- First spawn becomes the server; later spawns auto‑detect and become WS clients.

---

## 2. Architecture (one diagram)

```
                    ┌─────────────────────────────────────────────────────┐
                    │           ai-browser-copilot-win-x64.exe            │
                    │      (single binary, two roles, port 7483)          │
                    │                                                     │
 stdio MCP ───────► │  PRIMARY (first spawn)                              │
 (this client)      │   ├─ port 7483 free → bind WS server                │
                    │   ├─ handle own stdio MCP                           │
                    │   ├─ accept WS extensions  (?browserId=…)           │
                    │   └─ accept WS MCP clients (?role=mcp)              │
                    │                                                     │
 stdio MCP ───────► │  SECONDARY (later spawns)                           │
 (other clients)    │   ├─ port 7483 taken → connect ws://127.0.0.1:7483  │
                    │   └─ proxy own stdio ↔ WS (auto-detect framing)      │
                    └─────────────────────────────────────────────────────┘
                              ▲                            ▲
                  ws://…?browserId=chrome     ws://…?browserId=edge
                              │                            │
                       ┌──────┴──────┐              ┌──────┴──────┐
                       │  Chrome ext │              │   Edge ext  │
                       └─────────────┘              └─────────────┘
```

Total moving parts: **1 binary, 1 TCP port**. No lock file for discovery, no
helper binary, no native-messaging manifest required for connection setup.

---

## 3. Process flow

### 3.1 Binary startup (`packages/native-host/src/index.ts`)

```ts
const PORT = 7483;
const probe = net.createServer();
probe.listen(PORT, '127.0.0.1', () => {
  // Port free → become server; own stdio is the "primary" MCP client
  probe.close(() => startServer(PORT));
});
probe.on('error', () => {
  // Port taken → connect as WS MCP client; proxy stdio↔WS
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}?role=mcp`);
  // …auto-detects NDJSON or Content-Length framing
});
```

Because both modes are produced by the **same** binary, the MCP host (`mcp.json`,
`claude_desktop_config.json`, etc.) only ever needs to know one path:

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "ai-browser-copilot": {
      "command": "${env:LOCALAPPDATA}/ai-browser-copilot/ai-browser-copilot-win-x64.exe",
      "args": []
    }
  }
}
```

### 3.2 Server (`packages/native-host/src/service.ts`)

The first binary that grabs port 7483 runs:

- `WebSocketServer` on `127.0.0.1:7483`
- One stdio MCP handler for the primary client (the one that spawned it)
- Extensions connect with `?browserId=chrome|edge|brave|…` and stay in
  `browserSockets: Map<browserId, WebSocket>`
- Secondary MCP clients connect with `?role=mcp` and stay in
  `mcpClients: Map<clientId, WebSocket>`
- Pending tool requests are tracked in `pendingRequests` keyed by request id

### 3.3 Tool dispatch

```
MCP client                Server                   Browser ext
   │  initialize ─────────►│                            │
   │◄──── server_info ─────│                            │
   │                       │                            │
   │  tools/list ─────────►│ inject `browser` enum      │
   │◄──── full schema ─────│ from connected browsers    │
   │                       │                            │
   │  tools/call ─────────►│ pick socket by browser ──► │
   │                       │   (or first if absent)     │
   │                       │                            │
   │                       │ ◄─────── tool result ──────│
   │◄────── result ────────│                            │
```

### 3.4 The `browser` parameter

The tool schemas in `packages/native-host/src/tools/*.ts` declare `args: []`. The
server injects `browser` as an enum at `tools/list` time, with values pulled from
`Array.from(browserSockets.keys())`. This keeps tool source files free of the
parameter and lets the enum reflect what is actually connected right now.

---

## 4. What was removed vs the original proposal

The earlier proposal added a long-lived **service** plus tiny per-client
**stubs** talking over an **IPC** channel (named pipe / unix socket), discovered
via a **lock file** read by a **native-messaging helper**.

The shipped design collapses that into one binary by using port 7483 itself as
the rendezvous. Removed components:

- `extension-relay.ts` (deleted)
- `mcp-server.ts` (deleted)
- `relay-integration.test.ts`, `extension-relay.test.ts` (deleted)
- IPC named-pipe layer (never built)
- Lock-file based discovery for MCP clients (kept only as breadcrumb for the extension UI)
- Native-messaging helper as a connection prerequisite

Net result: ~1 100 lines deleted; the binary is one Node entry point + one
service module.

---

## 5. Lifecycle

| Event | Behavior |
|---|---|
| First MCP client spawns binary | Becomes server, handles own stdio. |
| Second MCP client spawns binary | Becomes WS client, proxies stdio↔WS. |
| Browser opens with extension | Extension WS-connects with `?browserId=…`. Multiple browsers add to the map. |
| MCP client disconnects | Its slot in `mcpClients` (or the primary stdio) is freed. Server stays alive. |
| Browser disconnects | Slot in `browserSockets` is freed; pending tool calls for that browser fail fast. |
| Server idle | Stays alive. Killed only by user / OS. *(See note below — we may add a cleanup policy later.)* |

> **Note on idle shutdown:** The earlier draft auto‑exited after 60 s with no
> clients. That was removed because it interacted badly with `tools/list`
> warm‑up calls and produced flapping. A future revision may reintroduce a
> longer idle window or a tray‑driven shutdown — for now the server runs until
> killed.

---

## 6. Wire protocols

### 6.1 Stdio MCP (primary + secondary)

JSON-RPC 2.0 messages over stdio. Per the MCP spec the on-the-wire format is
**newline-delimited JSON** (`JSON.stringify(msg) + "\n"`); for legacy/test
parity the parser also accepts LSP-style **`Content-Length: N\r\n\r\n` + body**
framing. Format is auto-detected on the first valid message and latched for
the rest of the stdio session; replies use the same format the client sent.
The secondary client implements parsing in
`packages/native-host/src/index.ts`; the server implements it in
`parseStdioMessages` inside `service.ts`.

### 6.2 WebSocket (extensions + secondary MCP clients)

Plain JSON messages, one per WS frame. Query string selects role:

| Query | Role |
|---|---|
| `?browserId=chrome` (or `edge`, `brave`, …) | Browser extension |
| `?role=mcp` | Secondary MCP client (proxied stdio) |

There is no auth token in this revision — the listener is bound to
`127.0.0.1` only. Token reintroduction is tracked separately.

---

## 7. Verification

Run from `packages/native-host`:

```bash
npm run build && npm run compile:win
# copy bin\ai-browser-copilot-win-x64.exe to %LOCALAPPDATA%\ai-browser-copilot\
```

End-to-end test (simulates how MCP clients spawn the binary):

```bash
node -e "
const cp = require('child_process');
const c = cp.spawn(process.env.LOCALAPPDATA + '/ai-browser-copilot/ai-browser-copilot-win-x64.exe', [], { stdio: ['pipe','pipe','pipe'] });
let buf = Buffer.alloc(0), cl = -1;
c.stdout.on('data', chunk => { /* parse NDJSON lines, send initialize then tools/call list_tabs */ });
"
```

Expected: `initialize` returns `server_info`; `tools/call list_tabs` returns the
live browser tabs as JSON.

All 398 unit tests across the four packages pass:

```
extension          97 passed
installer         262 passed
native-host        28 passed
native-host-helper 11 passed
```

---

## 8. Future work

- Reintroduce auth token in WS handshake (lightweight, browser-only).
- Idle / tray-driven shutdown policy.
- Multiple browsers of the same kind (e.g. two Chromes) — add a stable
  client-supplied id to disambiguate.
