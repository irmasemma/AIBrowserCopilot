# Browser MCP (AgentHub) Connection Investigation

_Logged: 2026-06-05_

## Symptom

Browser tools (`mcp__agenthub__*`) appear fully connected — the extension popup shows
`State: connected` — but I cannot see any active tab content. `list_tabs`, page content,
metadata, and screenshots all return **empty (not errored)**. Target page the user was
viewing: `https://postcopilot.ai/threads-follower-export`.

## Probe results (live tool calls)

| Probe | Result | Meaning |
|---|---|---|
| `list_tabs` (default) | `{"tabs": []}` — first call earlier returned `timeout` on `chrome:0b0cf681...` | Connection alive; 0 tabs |
| `list_tabs browser=chrome` | `{"tabs": []}` | Chrome extension responds, sees **0 tabs** |
| `list_tabs browser=edge` | `No browser extension connected` | No extension in Edge |
| `list_tabs browser=brave` | `No browser extension connected` | No extension in Brave |
| `get_page_metadata` / `get_page_content` / `take_screenshot` | empty, no error | Nothing readable — no active tab in scope |
| `browsermcp` (separate bridge) | `No connection to browser extension` | Unrelated second bridge, not connected |

**Not Incognito** (user confirmed normal window) and **not a transport fault** — the WS,
port, and heartbeats are all healthy.

## Extension diagnostic (pasted by user)

```
State: connected
Diagnostic reason: connecting        <-- never reaches "ready"
Server PID: 11380
Port: 7483
Version: 0.5.4
Build: dev
Uptime: 8m 6s
Started by: autostart
Browsers: chrome:5d266380-cc16-47e9-b14a-452a30a2a515   <-- live browser
MCP clients: 4
Reconnects this session: 4
Missed heartbeats: 0
Helper version: 0.5.2                 <-- skew vs server 0.5.4
Binary path: C:\Users\semma\AppData\Local\agenthub\agenthub-win-x64.exe (present)
PID alive: true / Port listening: true / WS healthy: true
```

Key tells: `Diagnostic reason: connecting` (handshake never completes), live browser
`5d266380` ≠ the `0b0cf681` my tools kept hitting, helper/server version skew,
`Reconnects this session: 4`, `MCP clients: 4`.

## On-disk evidence

Directory `C:\Users\semma\AppData\Local\agenthub\`:

```
agenthub-win-x64.exe                                ProductVersion 18.5.0  modified 5/14 1:37 PM
agenthub-helper-win-x64.exe                         ProductVersion 18.5.0  modified 5/14 1:37 PM
agenthub-win-x64.exe.delete-me-1778780245182        modified 5/14 12:25 PM   <-- stuck auto-update artifact
bridge.log, server.lock, extension-ids.json, com.agenthub.native_host*.json
```

- `server.lock` → `pid 11380, version 0.5.4, startedAt 2026-05-14T23:23:53Z`.
- `extension-ids.json` → single Chrome extension `ehchmchlmggdigicfjfmlgcbhdcdcmll`
  (explains Edge/Brave "no extension").
- Both native-host manifests launch the exes via **stdio native messaging** (Chrome spawns
  its own host process on connect).
- **Both on-disk exes are the same build** (ProductVersion 18.5.0, identical mtime) — the
  `18.5.0` is the pkg/Node runtime, not the app version.

### `bridge.log` — rapid May-14 dev-build churn + restart storm

50 server starts logged, all `buildId=dev`. Version progression in ~6 hours:

```
~12:25  .delete-me artifact created (updater begins replacing locked exe)
 13:35  server v0.3.2 -> v0.5.1
 13:37  new binaries written to disk (mtime = preserved build time)
 16:26  server v0.5.1 -> v0.5.4
 19:23  PID 11380 starts as v0.5.4  (still running 3 weeks later)
```

Bursts every ~30s (e.g. 16:26:53 → 16:27:23 → 16:27:30 → 16:27:45 → 16:28:15) confirm
crash-loop / flapping during the rollout.

### Running processes + port owner (the smoking gun)

```
PID 11380  started 5/14  7:23 PM  ← OWNS port 7483 (Listen + all Established)
PID 16484  started 6/5  10:40 AM  ← orphan (today)
PID 24296  started 6/5  10:34 AM  ← orphan (today)
PID 32872  started 6/5   9:09 AM  ← orphan (today)
```

`Get-NetTCPConnection -LocalPort 7483` → all owned by **PID 11380** (the 3-week-old
instance). No `agenthub-helper-win-x64.exe` process was running at all.

## Root cause

**Stale-process duplication.** A May-14 server instance (PID 11380) never died and is still
squatting on port 7483. Today's real browser activity spawned three sibling native-host
processes (Chrome-launched via stdio), but because the port was already held, none could
become the coordinating server. Result:

1. **MCP clients (me) connect to `127.0.0.1:7483`** → always land on the stale PID 11380,
   whose registered browser is the dead `0b0cf681` → timeouts / empty tabs.
2. **The live browser `5d266380`** is registered with one of today's orphan processes — a
   different process that does **not** own the port and does **not** share state with 11380.
3. The two halves never reconcile → handshake stuck at `Diagnostic reason: connecting` →
   tab queries resolve to a session with zero tabs.

`MCP clients: 4` and `Reconnects this session: 4` are this four-process split showing through.
The `.delete-me` artifact + 50 restarts explain how it got here: the auto-updater kept
relaunching, never managed to kill/replace the port-holder, and each reconnect stacked
another orphan.

### Theory that was DISPROVEN

Earlier I suspected the **helper 0.5.2 vs server 0.5.4 version skew** was the root cause.
It is **not** — both on-disk binaries are the same build. The skew is a *symptom*: see below.

### Why "Helper version: 0.5.2" (older than server) — explained

There is **no older helper file on disk.** The `0.5.2` is a runtime value cached in the
stale PID 11380 process. During the rapid May-14 rollout the components updated on different
cadences (server stepped 0.3.2→0.5.1→0.5.4; the helper's last-seen version was 0.5.2). PID
11380 performed its last discovery handshake with the helper mid-rollout, cached
`helper=0.5.2`, then froze — it has run untouched for 3 weeks and never refreshed. The helper
is a transient "discovery" process (it ran once, reported 0.5.2, exited — which is why no
helper process appears in the live list). So the skew is just the zombie server repeating a
3-week-old snapshot.

## Confidence

- **~95% / certain (directly observed):** four main-exe processes; PID 11380 solely owns
  7483; my tools hit that port; live ID `5d266380` ≠ resolved `0b0cf681`; both binaries are
  the same build (version skew is runtime-only, not a real downgrade); stuck-updater artifact;
  50-restart churn.
- **~75-80% (strong inference, one unverified link):** that the live browser is bound to an
  *orphan* process rather than to 11380 (inferred from the native-messaging architecture +
  ID mismatch; not directly captured). Soft alternative not fully excluded: a single-process
  handshake wedge in 11380 (dev-build bug) producing identical symptoms.
- **Helper-cache explanation: ~80%** (no live helper process supports the cache theory, but
  proving a negative wasn't done).

The proposed fix resolves **both** the duplication theory and the single-wedge alternative,
so confidence the fix works (~90%) is higher than confidence in the exact causal story.

## Proposed fix — NOT YET APPLIED (user said do not fix)

1. Kill all four `agenthub-win-x64.exe` processes (especially the May-14 PID 11380) to free
   port 7483.
2. Remove the stale `agenthub-win-x64.exe.delete-me-1778780245182` artifact so the updater
   can complete cleanly.
3. Let a single fresh instance start and bind the port, then reconnect the Chrome extension
   so one server owns both the WebSocket and the live browser session.
4. Verify: exactly **one** PID owns 7483, `Diagnostic reason` reads ready (not `connecting`),
   and `list_tabs` returns the live `5d266380` session with real tabs.

### Optional pre-fix verification (push diagnosis to ~95%)

- Map each agenthub PID to its parent process / open stdio handles — confirm the three
  orphans are Chrome-spawned native hosts and 11380 is the autostart instance.
- Search for any live helper process + read its embedded version to confirm the cache theory.

## What will actually help (recommendation)

Ranked from "fixes it today" to "stops it recurring":

1. **Clean-slate restart — do first (~90% it restores tab visibility).**
   The whole broken state stems from the 3-week-old PID 11380 squatting on port 7483.
   Kill **all four** `agenthub-win-x64.exe` processes (orphans included — kill only 11380 and
   an orphan just re-grabs the port half-initialized), delete the `.delete-me-*` artifact,
   restart the host, then click the extension to reconnect. Resolves both the duplication
   theory and the single-process-wedge alternative, which is why it's high-confidence despite
   the remaining diagnostic uncertainty.

2. **Update AgentHub off the `dev` build — fixes the recurrence (the real cause).**
   The restart only fixes today. Two design flaws in this dev build let it rot:
   - **Dual spawn paths** (`autostart` *and* Chrome native-messaging) with a broken
     single-instance handoff: the loser of the port race becomes an orphan instead of exiting
     → that's how four processes accumulated.
   - **Windows self-update can't replace a locked exe** → the `.delete-me` artifact → updates
     never finish → the stale process lives forever.
   A current stable release is the most likely durable fix for both — single-instance locking
   and update-on-Windows handling are exactly what gets hardened between a dev 0.5.x and a
   stable build.

3. **If staying on the dev build — prevention.**
   - Pick **one** launch path (disable `autostart` OR rely on native-messaging) so two
     mechanisms aren't racing for the port.
   - Early-warning check: flag whenever more than one `agenthub-win-x64.exe` is running or a
     `.delete-me` file exists — those are the two leading indicators.

### Automation status

- **Not automated today.** Recovery has been fully manual (kill processes → delete artifact →
  reconnect).
- A one-command PowerShell repair script was drafted (stop all instances → wait for port to
  free → clean `*.delete-me-*` + stale `server.lock` → relaunch via the real autostart entry
  → verify a single owner of the port), but **not adopted** — left as a future option rather
  than committed, pending a decision on whether to ship recovery tooling vs. just updating the
  build.
