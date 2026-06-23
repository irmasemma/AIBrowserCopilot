---
title: Multi-Profile Tab Fan-Out — Design Notes
date: 2026-05-08
author: Amelia (Dev)
status: design / pre-story
tags: [bridge, multi-browser, multi-profile, list_tabs, routing, browserId]
related:
  - docs/multi-client-architecture.md
---

# Multi-Profile Tab Fan-Out — Design Notes

## Use case

User runs three Chrome instances simultaneously, each under a different
Chrome profile (separate user accounts on the same machine — common dev
setup: personal / work / client). The extension is installed in at least
one of those profiles. When `list_tabs` is called via MCP, the result
contains tabs from **only one** of the three Chromes. Tabs from the other
two profiles are invisible.

Expected: one `list_tabs` call returns tabs across all profiles where the
extension is installed.

## Why this is not a Chrome API limitation

Each Chrome profile is a separate browser instance with its own copy of
the extension and its own isolated tab universe. `chrome.tabs.query({})`
inside one profile cannot see another profile's tabs — Google enforces
this at the Chromium level for privacy reasons.

This is **not** the bug. Cross-profile visibility was never going to come
from a single extension instance.

The bug is in the bridge: the bridge already has the mechanism to route
calls across multiple connected extensions, but its registry collapses
all Chrome connections into a single slot, so only the most recent
profile to connect is reachable.

## Root cause

Bridge registers connected extensions in a `Map<string, WebSocket>` keyed
by **browser brand**, not by profile.

[packages/native-host/src/service.ts:76](../packages/native-host/src/service.ts#L76):
```ts
browserSockets.set(browserId, ws);
```

The `browserId` value comes from the WebSocket URL query string
(`?browserId=chrome|edge|brave|...`). All Chrome profiles register with
the same string (`"chrome"`), so each new connection **overwrites** the
previous entry.

Routing logic at [packages/native-host/src/service.ts:146-148](../packages/native-host/src/service.ts#L146-L148):

```ts
const ws = browserSockets.get(browserId)
  || browserSockets.get('default')
  || Array.from(browserSockets.values()).find((s) => s.readyState === WebSocket.OPEN);
```

So when an MCP tool call arrives:
1. Look up the requested `browserId` (single slot per brand).
2. Fall back to `"default"`.
3. Fall back to "any open socket" (insertion order of the Map).

In all three cases there is exactly **one** WebSocket considered. The
other Chrome profiles still hold open sockets but are unreachable —
silently evicted from the registry on the last `set()`.

Net effect: with N Chrome profiles open, the bridge talks to whichever
one connected most recently. The other N-1 are orphaned.

## Design — fan-out

Goal: one `list_tabs` call surfaces tabs from every connected extension
instance, regardless of profile or brand.

### 1. Profile-unique browserId

Today: `?browserId=chrome` for every Chrome profile.
Change to: `?browserId=chrome:<uuid>` where `<uuid>` is generated on
first run and stored in `chrome.storage.local`. Persisted, never
changes for that install. Survives Chrome Web Store, dev mode, and
works across browser brands.

Bridge changes:
- `Map<string, WebSocket>` keyed by the new unique id.
- A separate index `Map<brand, Set<browserId>>` lets us answer "give me
  every Chrome connection."

### 2. Tab ID collision across profiles

Chrome assigns tab IDs as integers, monotonically per profile. Profile A
and Profile B can both have `tabId: 622786441`. If `list_tabs` returns
both raw, then `click_element({ tabId: 622786441 })` is ambiguous.

**Namespace at the bridge.** Return opaque IDs of the form
`chrome:<uuid>:622786441`. Every tool that takes `tabId` parses the
prefix to route the call. Old single-browser callers passing a raw int
keep working — the bridge falls back to "the only connected browser" when
the id has no prefix.

Alternative considered and rejected: adding a sibling `browserId`
parameter to every tool. Doubles the surface area, the LLM has to track
two correlated fields, and we still need namespacing if `list_tabs`
returns a flat list of ints from multiple profiles.

### 3. No active-tab fallback — tools require explicit `tabId`

Today, when `tabId` is omitted, the dispatcher uses
`chrome.tabs.query({ active: true, currentWindow: true })`
([packages/extension/src/background/tool-dispatcher.ts:202](../packages/extension/src/background/tool-dispatcher.ts#L202)).
This was intended as a convenience but creates silent misroutes: the
agent's chain of operations can jump to a different tab mid-task if the
user switches windows or closes the tab the agent was working on.

New rules:
- Every tool that targets a tab requires an explicit `tabId`.
- **Side panel chat** binds the source tab at chat-open time and passes
  that `tabId` on every subsequent call. Not a fallback — an explicit
  binding computed once by the panel.
- **External MCP clients** (Claude Code, Cursor, etc.) must call
  `list_tabs` first, pick a tab, and pass `tabId` on every call.
- **Closed/missing tab** → tool errors with `TAB_NOT_FOUND`. Agent
  decides whether to re-list, ask the user, or give up.

Side effect: multi-profile ambiguity disappears entirely. Every call is
namespaced via the tabId; no fallback magic, nothing to disambiguate.

### 4. Fan-out failure modes

`list_tabs` becomes a broadcast: send to every connected extension,
gather responses, merge.

Required protections:
- Per-browser timeout (~2s). One frozen extension must not block the
  whole call.
- Partial-result envelope:
  ```json
  {
    "tabs": [...],
    "errors": [{ "browserId": "chrome:<uuid>", "error": "timeout" }]
  }
  ```
- Connection liveness check before fan-out — drop sockets in
  `CLOSING`/`CLOSED` states from the iteration set.

## What stays the same

- Bridge process, lock file, port discovery, auth token — unchanged.
- MCP tool schemas — unchanged on the wire (tab IDs are still strings,
  just opaque now).
- Single-browser flows — unchanged. Raw int tab IDs still resolve via
  the "only connected browser" fallback.

## `list_tabs` payload — minimal

Each entry returns the namespaced `id` only. Profile/browser info is
embedded in the id prefix; LLM parses if needed. No separate
`browserId` field per tab — keeps payload small.

```json
{
  "tabs": [
    { "id": "chrome:abc123:622786441", "title": "...", "url": "..." }
  ]
}
```

## Story sizing

| Item | Where | Size |
|---|---|---|
| Profile-unique `browserId` in extension | `packages/extension/src/background/connection.ts` | Small |
| Per-profile registry in bridge | `packages/native-host/src/service.ts` | Small |
| Namespaced tab IDs | `packages/native-host/src/service.ts` + every tool wrapper | Medium |
| Fan-out for `list_tabs` | `packages/native-host/src/service.ts` + `packages/native-host/src/tools/list-tabs.ts` | Small |
| Remove active-tab fallback | `packages/extension/src/background/tool-dispatcher.ts` | Small |
| Tests for all of the above | `service.test.ts`, new e2e | Medium |

Total: medium story, 2–3 days with tests.

## Related but out of scope

**Forced tab activation** — every tool that takes `tabId` currently
calls `chrome.tabs.update(tab.id!, { active: true })` unconditionally
([packages/extension/src/background/tool-dispatcher.ts:200](../packages/extension/src/background/tool-dispatcher.ts#L200)).
Only `take_screenshot` actually requires it (Chrome's `captureVisibleTab`
only works on the active tab). For `click_element`, `fill_form`,
`extract_data`, `get_page_content`, etc., `chrome.scripting.executeScript`
works on background tabs without activation. Separate small story —
filed independently.

## Related symptom: connection drops during agent runs

### Reported symptom

User reports: when an agent is operating on a specific tab (with explicit
`tabId`), if the user switches to a different tab or window mid-run, the
agent's connection appears to drop. The next tool call fails. The
extension reconnects shortly after, but the in-flight work is lost.

This is real and reproducible. Tab switching is not the *cause* — it
correlates with conditions that trigger Manifest V3 service worker
eviction.

### Root cause: MV3 service worker eviction

The WebSocket to the bridge lives inside the extension's service worker
([packages/extension/src/background/connection-manager.ts](../packages/extension/src/background/connection-manager.ts)).
Chrome MV3 evicts service workers after ~30 seconds of inactivity.
"Inactivity" means no events, no messages, no alarms, no WS traffic.

When the SW dies:

1. The WebSocket closes.
2. The bridge logs `Browser disconnected: <browserId>`
   ([packages/native-host/src/service.ts:104](../packages/native-host/src/service.ts#L104)).
3. Any in-flight tool request (one the bridge has forwarded but not yet
   received a response for) times out after 30 s with
   `Tool request timed out`
   ([packages/native-host/src/service.ts:159-162](../packages/native-host/src/service.ts#L159-L162)).
4. From the MCP client's perspective, the tool call returns an error.

Self-heal: the extension's reconciliation alarm fires every 30 s
([packages/extension/src/entrypoints/background.ts:96](../packages/extension/src/entrypoints/background.ts#L96)),
which respawns the SW, reconnects, logs `Browser connected: <browserId>`
([packages/native-host/src/service.ts:75](../packages/native-host/src/service.ts#L75)).
The agent appears to "come back" — but the lost request is gone.

### Existing keepalives (and why they aren't enough)

Two mechanisms try to keep the SW alive:

- **Reconciliation alarm** — every 30 s
  ([packages/extension/src/entrypoints/background.ts:13-14](../packages/extension/src/entrypoints/background.ts#L13-L14)):
  ```ts
  const ALARM_NAME = 'connection-check';
  const ALARM_PERIOD_MINUTES = 0.5; // 30s — Chrome minimum for periodic alarms
  ```
- **Heartbeat** — every 20 s with 3 missed = dead
  ([packages/extension/src/background/heartbeat-monitor.ts:7-11](../packages/extension/src/background/heartbeat-monitor.ts#L7-L11)):
  ```ts
  export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
    intervalMs: 20_000,
    timeoutMs: 5_000,
    maxMissed: 3,
  };
  ```

These keep the SW alive in steady state. The risky window is when the
agent is **thinking** (LLM has not yet decided the next tool). During
that pause, no tool dispatches fire. Only the heartbeat is keeping the
SW warm. If anything else tips the balance — for example, the user
switches windows and the side panel closes, removing one more anchor —
Chrome reaps the SW between alarm ticks.

### What correlates with eviction (the "tab/window switch" trigger)

User actions that increase eviction probability:

- **Switch to a different Chrome window** — side panels are per-window.
  The original side panel closes, dropping its `chrome.runtime.sendMessage`
  channel with the SW. One less anchor.
- **Switch to a different Chrome profile** — that profile has its own
  extension SW; the original profile's SW is now in an "idle profile"
  Chrome aggressively reaps.
- **Side panel collapse / window minimize** during an agent run.
- **OS sleep / lid close** for any duration > heartbeat dead threshold.

Tab switching *within the same window* is mostly safe — the side panel
stays attached and at least one anchor remains.

### Confirming evidence

The diagnostics panel (side panel → Connection diagnostics) exposes the
fields that confirm this is happening:

- `Reconnects this session` — increments each time the WS dies and is
  restored. A jump after a window switch confirms eviction.
- `Missed heartbeats` — spikes from 0 to 1, 2, or 3 right before the
  WS is declared dead. If this hits 3 mid-agent-run, that is the SW
  going down.

Both are surfaced in the diagnostics text report (Copy report button) at
[packages/extension/src/sidepanel/components/diagnostics-panel.tsx:158-159](../packages/extension/src/sidepanel/components/diagnostics-panel.tsx#L158-L159):

```ts
`Reconnects this session: ${ctx.reconnectsThisSession}`,
`Missed heartbeats: ${ctx.missedHeartbeats}`,
```

Bridge stderr (visible if the user runs the bridge from a terminal
manually instead of via autostart) shows the matching disconnect/reconnect
pair:

```
Browser disconnected: chrome
Browser connected: chrome
```

### Example reproduction

1. Open extension side panel in Chrome window A.
2. Verify `Reconnects: 0`, `Missed heartbeats: 0` in diagnostics.
3. Start a long-running agent task (one that requires the LLM to think
   between tool calls — e.g., "summarize this page then click each link
   and tell me what each section is about").
4. While the LLM is thinking (no tools dispatched for >20 s), switch to
   Chrome window B (different window, not just a different tab).
5. Wait ~30 s.
6. Switch back to window A; reopen diagnostics.
7. Expected: `Reconnects` is now 1+, the agent reports a tool failure
   for whatever was in flight at the moment of eviction.

### Mitigation paths (not part of this story)

Three options, ordered by cost:

1. **Tighten the alarm during in-flight requests.** When a tool is
   pending response, switch the alarm period to its tightest setting and
   send a self-message every 10 s to keep the SW awake. Cheapest, but
   only protects active dispatches, not LLM-thinking pauses.

2. **Persistent keepalive port from the side panel.** Side panel opens
   a `chrome.runtime.connect` port to the SW and holds it. As long as
   the panel is open, the SW cannot be evicted (Chrome treats a connected
   port as activity). Doesn't help when the panel is closed (window
   switch, multi-window setups), but covers the common single-window
   case.

3. **Move the WebSocket out of the SW into an offscreen document.**
   Offscreen documents have their own lifecycle — they live as long as
   they have a reason to live (audio playback, IFrame, WebRTC, etc.).
   The `BLOBS` reason allows long-lived connections. WS survives SW
   eviction. Most robust, but biggest change. Requires
   `offscreen` permission and a refactor of the relay-client +
   connection-manager to communicate across the SW/offscreen boundary.

Option 3 is the right long-term answer. Option 2 is a near-term patch
worth doing first.

### Story sizing (for the SW-eviction work)

| Item | Where | Size |
|---|---|---|
| Side panel keepalive port | `packages/extension/src/sidepanel/main.tsx` + `packages/extension/src/entrypoints/background.ts` | Small |
| In-flight-tool alarm tightening | `packages/extension/src/background/tool-dispatcher.ts` + `packages/extension/src/entrypoints/background.ts` | Small |
| Move WS to offscreen document | `packages/extension/src/offscreen/` (new) + connection-manager refactor + manifest permissions | Large |
| Tests (eviction simulation, reconnect flow) | new e2e | Medium |

Recommend doing options 1+2 as a single small story; option 3 as a
follow-up if symptoms persist.

## Decisions (settled)

1. **Profile-unique `browserId` derivation** — per-install UUID stored in
   `chrome.storage.local`. Generated on first run, persisted, never
   changes for that install. Composite browserId = `${brand}:${uuid}`.
   Survives Chrome Web Store, dev mode, and works across browser brands.
2. **No active-tab fallback.** Every tab-targeting tool requires explicit
   `tabId`. Side panel chat binds the tab at chat-open. External MCP
   clients must `list_tabs` first. Missing/closed tab → `TAB_NOT_FOUND`.
3. **`list_tabs` payload — minimal.** Each entry returns the namespaced
   `id` only (e.g. `chrome:abc123:622786441`). Profile/browser info is
   embedded in the id prefix; LLM parses if needed. No separate
   `browserId` field per tab — keeps payload small.
