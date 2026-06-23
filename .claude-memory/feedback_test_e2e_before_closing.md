---
name: Test end-to-end flow before closing
description: User found multiple bugs in the extension connection flow that passed unit tests but failed in real Chrome
type: feedback
---

Don't just run unit tests — test the actual user flow when closing integration work.

**Why:** Extension installer had 180+ passing tests but the actual Chrome connection flow failed due to: (1) wildcard extension ID rejected by Chrome, (2) connectNative returns a port that immediately disconnects but code treated it as "connected", (3) native host speaks WebSocket not native messaging protocol, (4) infinite reconnect loops because attempt counter reset on each try.

**How to apply:** For extension/browser work, always verify in real Chrome after code changes. Unit tests can't catch Chrome API behavior (connectNative doesn't throw, lastError semantics, allowed_origins validation). When multiple components interact (installer → manifest → Chrome → extension → native host → relay), trace the full chain.
