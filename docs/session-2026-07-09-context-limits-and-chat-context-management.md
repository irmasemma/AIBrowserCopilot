# Session 2026-07-09 — Tool output caps + sidepanel chat context management

## Incident

A user asked the **in-extension sidepanel chat** to scroll an infinite-scroll Threads
profile (`threads.com/@tech.mom_us`) and export all posts. After 7 scrolls the chat
called `get_page_content` (format `html`), which returned the entire accumulated page
verbatim. The next Anthropic API call died with:

```
prompt is too long: 403154 tokens > 200000
```

The raw API error string was shown to the user. The same task later **succeeded from
Claude Code via MCP** — which caused confusion ("why does MCP work but chat doesn't?").

## Root cause (validated against logs + code, not guessed)

Two independent defects, plus a client-behavior difference:

1. **Unbounded tool results.** `get_page_content` returned `document.body.innerText`
   / `innerHTML` with no size bound (`tool-dispatcher.ts`, old line ~616). One tool
   result was 403,154 chars. `snapshot` had the same unbounded shape.
2. **No context management in the sidepanel chat.** The chat dispatches tools directly
   in the extension (`chat-engine.ts` → `dispatch_tool` runtime message →
   `dispatchTool`, **bypassing the bridge entirely** — that's why bridge.log had no
   trace of the failed session; chat-path dispatches carry an `activityId` but no
   `ext.tool_request.received`/bridge `requestId`). Every tool result was inlined
   verbatim into the conversation, the full transcript was re-sent on every API call,
   and nothing was ever pruned. Context-length 400s were surfaced raw.
3. **Why Claude Code survived the same payloads:** the Messages API is stateless and
   both clients re-send history; Claude Code truncates/offloads oversized tool results
   and compacts its own context (client-side behavior, outside this repo). Our server
   treated both clients identically — no bridge-side per-client difference.

Also found during RCA:

- `extract_data` failed on Threads with "No structured data detected on page" because
  `findRepeatingPatterns` grouped siblings by exact `tag+className`, and Meta's atomic
  CSS gives every post card a near-unique class → every group had size 1.
- The chat's bound-tab auto-injection didn't fire for `tab_id: 0` (the dispatcher
  deliberately rejects raw id 0, but the injection check only treated
  `undefined/null/''` as missing), so a hallucinated `tab_id: 0` failed instead of
  being auto-corrected.

## Changes

### Layer 1 — no tool may ever return an unbounded payload

- **`packages/extension/src/background/tool-dispatcher.ts`** — `capToolResult()`
  applied inside `dispatchTool` after every handler resolves: every `content[].text`
  is hard-capped at `TOOL_RESULT_MAX_CHARS = 80_000` (~20k tokens). Under/at cap
  passes through byte-identical; over cap gets an explicit marker
  (`[TRUNCATED: content was N chars, ...]`) — truncation is never silent. The marker
  hint is tool-agnostic (not every tool has pagination params).
- **`packages/native-host/src/service.ts`** — same cap/marker as a bridge-side
  backstop (`capResponseContent`) on the last hop before MCP clients, so a stale or
  future extension build can't leak an unbounded payload. A cross-package parity test
  (`service.test.ts`) asserts the 80k literal matches `tool-dispatcher.ts` so the two
  packages can't drift.
- **`packages/native-host/src/tools/get-page-content.ts`** — `get_page_content` now
  advertises `offset` / `max_chars` pagination params in its MCP schema so agents can
  deliberately walk a huge page in chunks.
- **Pagination/cap composition:** the page window is clamped to
  `TOOL_RESULT_MAX_CHARS - RESULT_OVERHEAD_RESERVE` (reserve = 1000) so
  window + scroll-position info + pagination marker can never exceed the outer cap.
  Without this, the outer cap sliced off the accurate page-relative continuation
  offset and replaced it with a response-relative one (wrong for any `offset > 0`
  call — it would send the model backwards). Tests cover `offset > 0` with remaining
  content ≥ cap and assert the *specific* correct continuation offset;
  `remaining === 0` produces no "call again" instruction.

### Layer 2 — sidepanel chat context management

- **`packages/extension/src/sidepanel/providers/anthropic.ts`**
  - Sends `anthropic-beta: context-management-2025-06-27` +
    `context_management: {edits: [{type: "clear_tool_uses_20250919"}]}` — the API
    clears stale tool results **server-side** before the model reads the prompt.
  - **Fallback:** a 400 that names `context_management` triggers one retry without
    the beta and sets a sticky module-level `contextManagementDisabled` flag — an
    unsupported model costs one extra round-trip once, never a bricked chat.
    Unrelated 400s do not trigger the fallback (inverse-case tested).
  - **Prompt caching:** `cache_control: {type: "ephemeral"}` on the system block
    (covers tools+system per render order) and on the last message's last content
    block — re-sent history bills at ~0.1×. System prompt is byte-stable across calls.
  - Thrown errors now carry `status` / `errorType` for classification upstream.
- **`packages/extension/src/sidepanel/chat-engine.ts`**
  - `isContextLengthError()` + `pruneOldToolResults()` + one-shot retry: on a
    context-length 400, tool-result text bodies outside the last 2 turns are replaced
    in place with `[cleared: was N chars]` (tool_use/tool_result pairing is never
    broken) and the request retried once. Already-cleared placeholders are not
    re-measured (idempotence guard).
  - Structured logging: `ext.chat.context.pruned` (`logRecord`) on both success and
    failure branches — turn counts and char counts only, no raw content.
  - Bound-tab auto-injection now also fires for `tab_id` 0/negative/non-finite,
    matching the dispatcher's definition of an invalid id.
  - System prompt tells the model `get_page_content` supports `offset`/`max_chars`
    and to paginate long/infinite-scroll pages instead of one giant read.
- **`packages/extension/src/sidepanel/components/chat-tab.tsx`** — surviving
  context-length errors render a friendly "start a new conversation" message instead
  of the raw API string; all other errors unchanged.

### extract_data on atomic-CSS sites

- **`packages/extension/src/content/data-detector.ts`** — tag-only fallback grouping
  pass (same consistency/density scoring, no quality-bar change) that runs only when
  the exact `tag+className` pass finds nothing. A negative-control test proves it
  doesn't manufacture structure on genuinely unstructured pages. The
  "No structured data" error now points to working alternatives.

## Request shape now sent by the chat (Anthropic provider)

```
headers:  x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access,
          anthropic-beta: context-management-2025-06-27   (unless disabled by fallback)
body:     model, max_tokens, system: [{text, cache_control: {type: "ephemeral"}}],
          messages: [..., last content block carries cache_control],
          tools, context_management: {edits: [{type: "clear_tool_uses_20250919"}]}
```

## Verification

- `packages/extension`: 403/403 tests pass. `packages/native-host`: 216/216.
- Extension `dist/` rebuilt and verified to contain the new code (grep for
  `contextManagementDisabled` / `ext.chat.context.pruned` in built bundles);
  `agenthub-win-x64.exe` recompiled (`npm run compile:win`).
- Changes were adversarially reviewed in a two-agent loop (author ↔ context
  specialist) until **APPROVE WITH NITS**. The review caught and fixed a real
  pagination-offset corruption bug and the unconditional-beta risk before merge.

## Known limitations / follow-ups

- `contextManagementDisabled` is session-global, not keyed by model — if an
  unsupported model is used first, a later supported model forgoes the optimization
  until restart. Follow-up: key by model (`Set<string>`). Non-blocking.
- Prune window is a fixed 2-turn constant, not token-aware — one enormous result
  inside the window could still overflow (bounded at 80k by Layer 1, so far less
  likely than before).
- Persisted transcript isn't trimmed after a successful prune-retry; a very
  long-lived conversation can re-approach the ceiling on later turns.
- Anthropic provider only; OpenAI/Gemini chat providers have no equivalent context
  management.

## Debugging notes for future incidents

- Chat-path tool dispatches: `ext.tool.dispatch.*` with `activityId` but **no**
  `ext.tool_request.received` → came from the sidepanel chat, not the bridge/MCP.
- Context prunes: grep `ext.chat.context.pruned` in `extension.log`.
- Anthropic API errors from the chat were previously unlogged; they now carry
  `status`/`errorType` — consider logging them in a follow-up.
