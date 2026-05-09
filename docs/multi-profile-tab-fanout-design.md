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
