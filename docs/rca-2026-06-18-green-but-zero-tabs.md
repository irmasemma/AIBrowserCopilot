# RCA — "Connected / all-green, but `list_tabs` returns 0 tabs"

**Date:** 2026-06-18
**Severity:** High (user gets no results while every diagnostic shows green)
**Status:** Root cause confirmed from logs. Self-healed; bridge since upgraded v0.5.10 → v0.5.13.

## Symptom

Chrome shows AgentHub **Connected**, and every diagnostic line is green:

- Helper available, Bridge binary present, Lock file present
- Process alive, Port 7483 listening
- Bridge protocol v0.5.13, Heartbeat on time

…yet `list_tabs` from the MCP client returns **0 tabs**, so the assistant has no
access to any page and (wrongly) concludes "no tabs open / extension is flaky."

## Root cause

An **orphan-socket / relay-churn wedge** — the exact failure class the single-relay
invariant was built to prevent. It was happening on the older **v0.5.10** bridge.

`list_tabs` is a fan-out tool. For each connected browser the bridge sends a
`tool_request` over that browser's WebSocket and waits up to `FAN_OUT_TIMEOUT_MS`
(10s). During a reconnect/backoff cycle the extension's JS ended up listening on a
**newer** socket (B) while the bridge still held a reference to the **old** socket
(A). The bridge sent the request on A; nothing handled it on the extension side; it
hit the 10s timeout and the fan-out merged to an **empty** tab array.

### Why every diagnostic was green

The diagnostics panel only probes **bridge-side** facts: lock file present, port
listening, bridge protocol responds, bridge heartbeat on time. **None of them send a
tool round-trip through the extension's *current* socket.** So a healthy bridge
holding a wedged/orphaned extension socket shows all-green while tools silently time
out. Green means "the bridge is up," not "the extension answers tools."

## Evidence (from `%LOCALAPPDATA%\agenthub\logs\`)

Failing session — bridge **v0.5.10** (pids 25284 → 26072):

`extension.log` 17:34:00–17:34:29 — relay churn:
```
ext.ws.close            code 1006   (~twice/sec for ~30s)
ext.ws.replacing_relay  reason "reconnect_before_old_close"
ext.ws.error            state "reconnecting"
ext.ws.open  + ext.ws.server_info   bridgeVersion 0.5.10   (clean reconnect at 17:34:35)
```

`bridge.log` — two `list_tabs` calls that each ran for the full fan-out timeout and
returned empty:
```
17:35:24  bridge.mcp.tools_call.received  list_tabs  routeSource "default"
17:35:34  bridge.mcp.tools_call.replied   list_tabs  durationMs 10011  isError false
17:35:52  bridge.mcp.tools_call.received  list_tabs  routeSource "default"
17:36:02  bridge.mcp.tools_call.replied   list_tabs  durationMs 10010  isError false
```
`durationMs ≈ 10000` is the smoking gun — a healthy fan-out returns in 30–50ms. The
10s value is `FAN_OUT_TIMEOUT_MS`, i.e. the target never replied.

Recovery — subsequent calls returned fast once the orphan cleared:
```
18:26:45  list_tabs  durationMs 34   isError false
19:21:45  list_tabs  durationMs 35   isError false
23:10:14  list_tabs (browser=chrome) durationMs 98  isError false   (bridge now v0.5.13)
```

> Note: the v0.5.10 merge left `isError` unset on an all-timeout result, so the MCP
> client saw a "successful" response whose content was actually empty. Current code
> (`mergeFanOutListTabs`) sets `isError: true` when **every** target fails — the
> failure is now at least visible. The `browser: edge|brave|arc` calls seen at
> 23:10 were the recovery session probing brands that aren't connected (0 targets,
> expected empty) — a separate, benign case.

## Why it works now

1. **Self-healed:** the orphan socket cleared (extension reconnected / orphan sweep),
   and later calls returned in tens of ms.
2. **Bridge upgraded** v0.5.10 → **v0.5.13**, which carries the identity-based
   collision guard (newest `?role=relay` wins unconditionally) and the churn fixes
   from v0.5.10 / v0.5.11. A stale-but-still-ponging socket can no longer block a
   real reconnect.

## Earlier misdiagnosis

The first response blamed a "flaky extension — toggle off/on, reload the tab." That
was the **wrong mechanism**. The extension was neither flaky nor disconnected; a
stale socket was wedged, and the bridge auto-recovers from that. Toggling/reloading
also fixes it (it forces a fresh reconnect), which is why such advice can *appear*
to work — but it treats a symptom and misattributes the cause.

## Residual gap (not fixed here — documented for later)

In current v0.5.13, nothing recovers a wedge **within a single tool call**:

| Mechanism | Catches a still-ponging orphan? |
|---|---|
| Pre-request `proveLive` (3s ping) | No — orphan pongs, so the probe passes |
| Global liveness sweep (15s) | No — it only closes sockets that *fail* to pong |
| `tool_request` timeout path | No — it logs + rejects, but does **not** close the socket or retry |

So if a socket pongs but won't dispatch tools, the user gets a timeout/empty result
and recovery depends on the extension choosing to reconnect.

**Candidate fix (deferred):** on a `tool_request` timeout, force-close the socket
(`ws.close(1011)`) to trigger a fresh canonical-relay reconnect, then retry the
request once on the new socket — applied to both `sendToolRequest` and each
`fanOutToolRequest` target, with a per-attempt timeout that fits two attempts inside
the 30s MCP ceiling. This is the most regression-prone code in the system (the
v0.5.10 and v0.5.11 fixes both lived here) and changing the native host requires a
full release cycle, so it should be built with dedicated reconnect-race tests and
reviewed before shipping.

**Diagnostics improvement (deferred):** `/api/state` already exposes per-browser
`liveness: live|stale` (stale = no inbound frame for >45s). Surfacing that in the
side-panel diagnostics would make "connected" reflect the tool path rather than just
bridge uptime, closing the all-green-while-wedged blind spot.
