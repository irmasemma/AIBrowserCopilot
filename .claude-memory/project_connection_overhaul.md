---
name: Connection Architecture Overhaul Plan
description: Active plan to simplify connection system and replace 54 mock tests with real integration tests — plan file at .claude/plans/delightful-plotting-torvalds.md
type: project
---

Connection system has fundamental issues found 2026-03-31. 10 bugs found in one debugging session, all missed by 400+ tests because 54 mock WebSocket so heavily they test nothing.

**Critical bugs fixed so far:**
- `sendToExtension()` missing `type: 'tool_request'` — tool calls silently dropped
- Token auth on localhost removed — was blocking all extension connections
- Native messaging helper built and registered — was never deployed
- `retry()` now re-discovers endpoint — was using stale URL
- `WS_CLOSE` in connecting state now handled — was silently ignored
- Compiled binary redeployed with fixes

**Why:** Overengineered connection architecture (circuit breaker, token auth, 6-state FSM, native messaging helper) created failure modes that mocked tests couldn't catch. The system should be simple: connect to ws://127.0.0.1:7483, reconnect forever with backoff, never give up.

**How to apply:** Full plan at `.claude/plans/delightful-plotting-torvalds.md`. Four phases:
1. Remove circuit breaker and error state — never give up on localhost
2. Delete 54 mock-shallow tests (connection-manager.test.ts, relay-client.test.ts)
3. Add ~10 real integration tests using real WebSocket connections
4. Verify: rebuild everything including compiled binary, test end-to-end
