# Multi-Client Architecture

**Status:** Proposal — branch `multi-client-architecture`
**Date:** 2026-05-06
**Scope:** native-host, native-host-helper, extension, installer

This document captures the design for letting multiple MCP clients (Claude Desktop, Claude Code, VS Code, Cursor, ...) and multiple browsers (Chrome, Edge, Brave, ...) share one local relay simultaneously, without the current "second client kills the first" behavior.

---

## 1. Problem

Today, when a second MCP client launches its own native host, the new host hits `checkExistingInstance === 'alive'` and **kills** the previous host's PID:

```ts
// packages/native-host/src/extension-relay.ts:138-146
const status = await checkExistingInstance(lockPath);
if (status === 'alive') {
  const lock = readLockFile(lockPath);
  if (lock) {
    process.stderr.write(`Taking over from existing instance (PID ${lock.pid})\n`);
    killProcess(lock.pid);                 // ⚠ this is the bug
    await waitForProcessExit(lock.pid);
  }
}
```

This means everyday setups fail:

- 2 VS Code windows in parallel → 2nd kills 1st
- Claude Desktop + Claude Code → 2nd kills 1st
- 2 Claude Code terminals → 2nd kills 1st

The browser side has the same shape of bug: the WS server holds a single `_ws` and evicts any prior one, so Chrome + Edge cannot be connected at the same time.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **MCP** | Model Context Protocol — JSON-RPC over stdio between LLM client and tool server. |
| **WS** | WebSocket — persistent bi-directional TCP socket. URL: `ws://127.0.0.1:<port>`. |
| **Service** | Long-lived local process. Owns the WS to extensions, owns the lock file, multiplexes all stubs. Singleton per machine per user. |
| **Stub** | Tiny per-MCP-client process. Replaces today's native host as the binary spawned over stdio. Pipes stdio ↔ IPC to the service. Has zero browser logic. |
| **IPC** | Local interprocess channel between stub ↔ service. Unix domain socket on macOS/Linux, Windows named pipe. |
| **Lock file** | `%LOCALAPPDATA%/ai-browser-copilot/server.lock`. Holds service PID, WS port, IPC path, auth token. |

---

## 3. Today's architecture (single-client)

```
┌─────────────────┐  stdio MCP   ┌────────────────────────────────────┐
│  MCP Client     │ ◄──────────► │  Native Host (Node.js)              │
│ (Claude Code,   │              │                                     │
│  VS Code, ...)  │              │  • MCP server over stdio            │
└─────────────────┘              │  • startRelay():                    │
                                 │     - checkExistingInstance         │
                                 │     - if 'alive' → KILL old PID ⚠   │
                                 │     - open WS on dyn port           │
                                 │     - write lock file               │
                                 │  • forwards tool calls to extension │
                                 └────────┬──────────────┬─────────────┘
                                          │              │
                          writes lock     │              │  WS ?token=…
                                          ▼              ▼
                              ┌────────────────────┐  ┌──────────────────────────────┐
                              │  server.lock file  │  │  Chrome Extension            │
                              │  %LOCALAPPDATA%/   │  │  ┌────────────────────────┐  │
                              │  ai-browser-copilot│  │  │ Service Worker         │  │
                              │  /server.lock      │  │  │  • discovers via       │  │
                              └────────▲───────────┘  │  │    com.copilot.        │  │
                                       │ reads via    │  │    native_host_helper  │  │
                                       │              │  │  • opens single WS     │  │
                              ┌────────┴───────────┐  │  │  • tool-dispatcher     │  │
                              │  Native messaging  │ ◄┼──┤    routes by tab_id    │  │
                              │  helper (one-shot) │  │  └────────────────────────┘  │
                              │  (read lock file)  │  │  ┌────────────────────────┐  │
                              └────────────────────┘  │  │ Side Panel chat        │  │
                                                      │  │  follows active tab    │  │
                                                      │  └────────────────────────┘  │
                                                      └──────────┬───────────────────┘
                                                                 │ chrome.tabs / scripting
                                                                 ▼
                                                      ┌──────────────────────────────┐
                                                      │   Browser tabs (any number)  │
                                                      └──────────────────────────────┘
```

**Wins over browsermcp/mcp:** dynamic port, token auth, explicit `tab_id` tool routing, multi-tab per client, multi-browser native-host registration.

**Same flaw as browsermcp:** hostile takeover on second host launch (see §1).

---

## 4. Proposed architecture — service + stubs

One long-lived **service** owns the WS to extensions and the lock file. Every MCP client launches a tiny **stub** that proxies stdio ↔ IPC to the service. The first stub auto-spawns the service if it isn't already running. The service stays alive as long as any stub is connected, plus an idle timeout.

```
                          ╔════════════════════════════════════════════════════════════╗
                          ║                      Local machine                          ║
                          ╚════════════════════════════════════════════════════════════╝

  MCP CLIENTS (stdio)                    ONE SERVICE                       BROWSERS (WS)
  ─────────────                          ──────────────                    ──────────────────────
  ┌──────────┐ stdio  ┌──────┐ IPC                                         ┌────────────────────┐
  │Claude    │ ◄────► │stub 1│ ◄──┐                                    ┌─► │Chrome              │
  │ Desktop  │        └──────┘    │                                    │   │ browserId=chrome   │
  └──────────┘                    │                                    │   │  ┌────┐ ┌────┐     │
                                  │                                    │   │  │tab1│ │tab5│ ... │
  ┌──────────┐ stdio  ┌──────┐ IPC│                                    │   │  └────┘ └────┘     │
  │Claude    │ ◄────► │stub 2│ ◄──┤                                    │   └────────────────────┘
  │ Code A   │        └──────┘    │   ┌────────────────────────────┐   │
  └──────────┘                    │   │      Service               │   │   ┌────────────────────┐
                                  ├──►│                            │ ◄─┤   │Edge                │
  ┌──────────┐ stdio  ┌──────┐ IPC│   │ Map<stubId, IPCSocket>     │   ├─► │ browserId=edge     │
  │ VS Code  │ ◄────► │stub 3│ ◄──┤   │ Map<browserId, WebSocket>  │   │   │  ┌────┐ ┌────┐     │
  └──────────┘        └──────┘    │   │ Map<reqId,                 │   │   │  │tab1│ │tab3│ ... │
                                  │   │   {stubId, browserId,      │   │   │  └────┘ └────┘     │
  ┌──────────┐ stdio  ┌──────┐ IPC│   │    startedAt}>             │   │   └────────────────────┘
  │ Cursor   │ ◄────► │stub 4│ ◄──┘   │                            │ ◄─┤
  └──────────┘        └──────┘        │ Routes:                    │   │   ┌────────────────────┐
                                      │   in:  stub  →  service    │   └─► │Brave               │
                                      │        (by stubId)         │       │ browserId=brave    │
                                      │   out: service →  ext      │       │  ┌────┐            │
                                      │        (by browserId)      │       │  │tab1│ ...        │
                                      │   ack: ext    →  stub      │       │  └────┘            │
                                      │        (by reqId map)      │       └────────────────────┘
                                      └────────────────────────────┘
```

### 4.1 Routing keys

| ID | Set by | Scope | Purpose |
|---|---|---|---|
| `browserId` | Extension on WS connect (e.g. `?browserId=chrome`) | chrome / edge / brave / arc / vivaldi | Pick the right WS |
| `tabId` | The browser itself (`chrome.tabs` API) | Per browser instance — **not unique across browsers** | Pick the right tab |
| `stubId` | Service assigns on stub IPC connect | Per running MCP client | Route response back to correct stub |
| `requestId` | MCP client (existing JSON-RPC `id`) | Per call within one stub | Match call ↔ response |

`(stubId, requestId)` uniquely identifies a call in flight. `(browserId, tabId)` uniquely identifies a tab.

### 4.2 Tool call surface

```jsonc
{
  "tool": "click_element",
  "args": {
    "selector": "...",
    "browser":  "chrome",   // optional, default = configured/last-used
    "tab_id":   5           // optional, default = active tab in that browser
  }
}
```

If `browser` is omitted: route to default browser (last-connected, or user-pinned).
If `tab_id` is omitted: extension uses active-tab fallback (already implemented in `tool-dispatcher.ts:21-40`).

### 4.3 Stub — pseudocode

```js
// The whole stub fits on one screen
const lock = readLockFile() ?? await spawnServiceAndWait();
const sock = net.connect(lock.ipcPath);
process.stdin.pipe(sock);
sock.pipe(process.stdout);
sock.on('close', () => process.exit(0));
```

The stub speaks no MCP, knows no WebSocket, knows no tabs. Pure pipe.

### 4.4 Service lifecycle

| Event | Behavior |
|---|---|
| First stub starts, no service | Stub spawns service (detached child), waits for `ipcPath` to be ready, connects |
| Second+ stub starts | Service already running → just connects |
| Stub exits (MCP client closes) | Service drops that stub's pending requests |
| All stubs gone | Service stays alive for `IDLE_TIMEOUT` (suggested 60 s), then exits cleanly |
| Service crashes | Stubs exit on stdio EOF → MCP clients see disconnect → next start respawns service |

### 4.5 Lock file format (after fix)

```jsonc
{
  "version":  "0.2.0",
  "pid":      12345,
  "port":     7483,             // WS port for extensions
  "token":    "abc...",          // WS auth
  "ipcPath":  "\\\\.\\pipe\\...",   // stub ↔ service IPC (Windows named pipe / Unix socket)
  "startedAt": "2026-05-06T10:00:00Z"
}
```

---

## 5. Multi-browser concurrent connections

Today the service worker holds a single `_ws`; a second extension WS evicts the first.

Change: service holds `Map<browserId, WebSocket>`. Each extension identifies itself in the WS upgrade:

```
ws://127.0.0.1:<port>?token=<x>&browserId=chrome&profileId=Default
```

| Piece | Effort |
|---|---|
| Service: `_ws` → `Map<browserId, WS>` | ~50 LoC |
| Extension: include `browserId` in WS query | ~10 LoC |
| Tools: optional `browser` arg, default fallback | ~30 LoC across handlers |
| Tests | ~80 LoC |

---

## 6. Scenario coverage matrix

| # | Scenario | Today | After service+stubs | After + multi-WS |
|---|---|:-:|:-:|:-:|
| 1 | Claude Desktop + Claude Code together | ❌ | ✅ | ✅ |
| 2 | 2 VS Code windows in parallel | ❌ | ✅ | ✅ |
| 3 | Switch window A↔B mid-task | ❌ | ✅ | ✅ |
| 4 | 2 Claude Code terminals | ❌ | ✅ | ✅ |
| 5 | Claude Desktop + VS Code + Cursor | ❌ | ✅ | ✅ |
| 6 | "New Chat" in same client | ✅ | ✅ | ✅ |
| 7 | Two chats hit same tab (race) | ⚠️ | ⚠️ | ⚠️ (needs per-tab mutex) |
| 8 | Tool with explicit `tab_id` | ✅ | ✅ | ✅ |
| 9 | Default → active tab | ✅ | ✅ | ✅ |
| 10 | Parallel tool calls to different tabs | ✅ | ✅ | ✅ |
| 11 | Parallel tool calls to same tab | ⚠️ | ⚠️ | ⚠️ (needs per-tab mutex) |
| 12 | Chat panel + multiple tabs in parallel | ❌ | ❌ | ❌ (needs chat↔tab pin) |
| 13 | Switch tabs mid chat conversation | ⚠️ | ⚠️ | ⚠️ (needs chat↔tab pin) |
| 14 | Chrome + Edge concurrent | ❌ | ❌ | ✅ |
| 15 | Chrome + Chrome Canary | ❌ | ❌ | ✅ |
| 16 | Random local proc probes the port | ✅ token | ✅ | ✅ |

Three orthogonal fixes cover everything:
1. **Service + stubs** → rows 1–5
2. **Multi-WS in service** → rows 14–15
3. **Per-tab mutex + chat↔tab pin** → rows 7, 11, 12, 13

---

## 7. Implementation plan

### Phase 1 — Service + stubs (rows 1–5)

**Native-host package — split into two binaries:**

- `packages/native-host/src/service.ts` (new)
  - Long-lived. WS server + token auth (port from existing logic).
  - IPC server (Unix socket / Windows named pipe).
  - `Map<stubId, IPCSocket>`, multiplexes by `(stubId, requestId)`.
  - Owns lock file with new `ipcPath` field.
  - Idle-shutdown timer.

- `packages/native-host/src/stub.ts` (new)
  - Reads lock file. If service alive → connect IPC.
  - If service missing/stale → spawn detached service, wait for ready, connect.
  - Pipes `stdin`↔IPC, IPC↔`stdout`. Exits on stdio EOF.

- `packages/native-host/src/extension-relay.ts`
  - Replace kill branch (lines 138–146) — delete file or repurpose for service-side WS handling.

**Installer package:**

- `packages/installer/src/installers/host-registrar.ts`
  - Update so the stub binary is what's registered as the native messaging host (the binary Chrome spawns on extension request — though after Phase 1 this path is barely used since the extension uses `native-host-helper` for discovery; keep for back-compat).
  - Update MCP client config writers to spawn the **stub** binary (was: native host).

- Lock file path / install paths unchanged — backward compatible for users who already installed.

**Tests:**

- Unit tests for service and stub.
- Integration: spin up service + 2 stubs, fire concurrent tool calls from both, assert each stub gets its own response.

### Phase 2 — Multi-WS (rows 14–15)

- Service: `Map<browserId, WebSocket>`, parse `browserId` from WS query.
- Extension: append `&browserId=<chrome|edge|brave|arc|vivaldi>` to WS URL. Detect via UA / build-time constant.
- Tool layer: optional `browser` arg in schemas; default fallback in service.
- Tests: two-extension fixture (Chrome + Edge), assert both connected, tool calls routable.

### Phase 3 — Chat↔tab pin + per-tab mutex (rows 7, 11, 12, 13)

- Extension: bind chat conversation to `tab_id` it was opened on. Persist in storage. Don't follow active-tab unless the user explicitly reattaches.
- Extension: per-`tab_id` `AsyncMutex` in `tool-dispatcher.ts` for write tools (`click`, `fill_form`, `navigate`, `type`). Read tools stay concurrent.

---

## 8. What does NOT change

- Native messaging registration (per-user, multi-browser): already correct; stays as is.
- Discovery via `com.copilot.native_host_helper`: unchanged.
- WS auth via lock-file token: unchanged.
- Tab dispatcher fallback to active tab: unchanged.
- Existing tools' implementations: unchanged.
- Extension IDs, manifests, CWS submission: unchanged.

---

## 9. Open questions

- **Windows named pipe ACL** — must scope to current user only, not Everyone.
- **Stub spawns service: race when two stubs start simultaneously** — both see no service, both spawn. Mitigation: stub atomically creates a `.starting` lock; loser waits and connects.
- **Service crash mid-flight** — stubs exit on stdio EOF; MCP clients receive transport errors and surface them. Acceptable Phase-1.
- **Default browser when multiple are connected** — last-connected? user-pinned via setup wizard? Decide before Phase 2.
- **Cross-machine / SSH scenarios** — out of scope. The model assumes localhost.

---

## 10. Cross-references

- Connection comparison vs browsermcp/mcp: `_bmad-output/planning-artifacts/connection-multiclient-analysis-2026-05-05.md`
- browsermcp/mcp architecture explainer: `_bmad-output/planning-artifacts/browsermcp-architecture-diagram.md`
- The kill bug location: `packages/native-host/src/extension-relay.ts:138-146`
- Today's tab dispatcher: `packages/extension/src/background/tool-dispatcher.ts:21-40`
- Browser native-messaging registration: `packages/installer/src/installers/browser-registrar.ts`
