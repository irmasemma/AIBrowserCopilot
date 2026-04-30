# Chat Tab — Phased Build Plan

Goal: turn the side panel into an agent that the user can talk to directly. The user types
"go to threads and scrape tech.mom_ua posts" and the extension translates that into the
existing tool calls (`navigate`, `extract_data`, etc.) — without needing Claude Code, Cursor,
or any external MCP client.

## Side panel layout (target)

The side panel becomes tabbed. **Chat is the default tab.**

| Tab            | Contents                                                       |
| -------------- | -------------------------------------------------------------- |
| **Chat**       | Conversation with the embedded LLM. Default tab.               |
| **Tools**      | Existing tool permission toggles + recent activity log.        |
| **Settings**   | OpenAI API key field, MCP connection status & diagnostics, support links. |

The `ConnectionHeader` (MCP status badge) stays at the top across all tabs as a thin
indicator. Setup wizard still takes over the screen on first launch when MCP isn't set up
(unchanged onboarding).

## Phase 1 — User-supplied OpenAI key

**Status: shipped 2026-04-29 (Phase 1 build), refined 2026-04-30 (model lock + connection fixes).**

Smallest possible loop that proves the chat is useful. Zero backend.

- User pastes their own OpenAI API key into Settings → stored in `chrome.storage.local`
  under `openaiApiKey`.
- Chat tab calls OpenAI directly: `POST https://api.openai.com/v1/chat/completions`.
- **Model: `gpt-4o-mini` only** — locked for now to cap token spend during validation.
  A model picker UI was built and then removed; `packages/extension/src/sidepanel/models.ts`
  is left in place so the picker is a 5-minute revert when we want it back.
- Each tool in the extension is exposed as an OpenAI function. Schemas live in
  `packages/extension/src/sidepanel/openai-tools.ts` (hand-written; mirrors the Zod
  schemas in `packages/native-host/src/tools/*.ts`).
- Side panel sends `{ type: 'dispatch_tool', name, params }` to the background service
  worker. The background reuses the existing `dispatchTool` from `tool-dispatcher.ts`,
  so chat and MCP go through the exact same tool implementations.
- Tool-call loop is capped at 10 iterations to prevent runaway agent behaviour. Tools
  execute sequentially (parallel would race for the active tab).
- Tool permissions are honoured — disabled tools in the Tools tab are filtered out of
  the OpenAI tool list before each request.
- No streaming, no markdown rendering, no chat history persistence beyond the current
  side-panel session. Keep UI deliberately simple.

**Risk for the user**: zero. The user's key never leaves their machine, never touches our
servers (we have none yet). If the key leaks, it's their key.

### Companion fixes shipped alongside Phase 1

- **Focus theft removed** — `tool-dispatcher.ts` no longer calls
  `chrome.windows.update(..., { focused: true })` when targeting a tab. Tab activation
  is kept (needed for `take_screenshot`) but Chrome no longer steals OS focus from
  whatever app the user is in.
- **Connection state coherence after SW reload**:
  - `getDisplayState` no longer treats `lastVerifiedAt === 0` as stale (that's
    "never verified", not "verification went quiet").
  - `ConnectionHeader` subtitle guards against rendering "Last confirmed Xm ago" when
    `lastVerifiedAt` is 0 (was producing the absurd "29624854m ago").
  - Background SW startup now always calls `manager.connect()` after termination —
    the previous `manager.reconcile()` path was a silent no-op because in-memory
    `context.state` is `'disconnected'` on a fresh SW boot. The popup and side panel
    now agree on connection state.

## Phase 1.5 — Multi-provider support (Anthropic, Gemini, Ollama)

**Status: planned. Triggered when users actually ask for it.**

Today, pasting an Anthropic key into the OpenAI key field silently fails with a 401
from `api.openai.com`. Two paths considered:

1. **Quick guard** — detect non-OpenAI keys at save/send time and show "Anthropic
   support is on the roadmap. Paste an `sk-…` key (not `sk-ant-…`)." No real
   support added; just stops misleading users. ~30 minutes.
2. **Proper provider abstraction** — refactor into a provider layer:
   `providers/openai.ts`, `providers/anthropic.ts`, etc. Settings gets a provider
   dropdown; key field label changes to match. Per-provider model picker. Anthropic's
   request shape differs meaningfully (separate `system` field, `x-api-key` header
   instead of `Bearer`, different tool-call field names) — half-day of focused work.

Decision: not started. Will revisit when a real user asks for it or before any
public launch. **Don't bake in the abstraction speculatively.**

**What this proves**: whether users actually want a chat agent inside the extension. If
they don't, no infrastructure spend was wasted.

## Phase 2 — Free tier on a shared key (proxy)

**Status: planned, build only after Phase 1 has real users.**

A small backend that holds *our* OpenAI key, so users get a free quota without supplying
their own key.

### Architecture

```
extension  →  https://api.copilot.app/chat  →  OpenAI
                  ↑ holds our OpenAI key (server-side only, never shipped)
                  ↑ verifies a per-user license token
                  ↑ enforces a daily token budget
                  ↑ logs usage for abuse detection
```

### Hosting

Cloudflare Workers + KV (cheapest for this shape — pennies/month at small scale, free tier
covers thousands of users). Worker is ~80 lines: validate token → check KV counter →
forward to OpenAI → decrement counter → return response.

### User identity

The existing `useLicense` hook (today gated for Pro features) is extended to issue a
free-tier license token to every user on first launch. The token is stored in
`chrome.storage.local` and sent as `Authorization: Bearer <token>` to the proxy. Server
keeps a KV record per token: `{ tokensUsedToday, lastResetAt }`.

This stops the trivial "uninstall and reinstall to reset quota" attack — but only if the
license issuance has *some* friction (email, Google sign-in, or anonymous device fingerprint
+ cooldown). Decide at Phase 2 design time.

### Quota

**Token-based, not request-based.** "10 requests per day" is gameable: one user can stuff
50k tokens into a single prompt and burn $0.05. A token budget caps the worst case.

Recommended free tier:
- **30k input tokens/day + 6k output tokens/day** (≈ $0.005/user/day at gpt-4o-mini pricing).
- Display remaining budget in the chat tab so users see why they're being throttled.
- Reset daily at UTC midnight.

### Fallback path

If the user has their own OpenAI key set in Settings, the extension uses it and skips the
proxy entirely — no quota applies. Users running into the daily cap are nudged to either
add their own key or upgrade to Phase 3.

## Phase 3 — Pay-as-you-go credits

**Status: planned.**

Stripe-backed prepaid credits for users who want more than the free tier without managing
their own OpenAI key.

### Flow

1. User clicks "Add credits" in Settings → opens Stripe Checkout (in a new tab).
2. Stripe redirects back with a session ID; webhook on our backend tops up their balance
   in KV: `{ balanceUsd: 5.00 }`.
3. Each chat request, before forwarding to OpenAI, the proxy checks balance. After OpenAI
   returns, the proxy decrements balance by the actual cost (input tokens × input rate +
   output tokens × output rate, with a small margin for our hosting).
4. Side panel shows live balance.

### Open questions for Phase 3

- Markup percentage (10–20% over OpenAI's rate is typical for a small markup).
- Refund policy for failed requests.
- Per-user spend cap (defense against compromised accounts).
- Whether credits expire.

These are decided when Phase 3 is on the table — not now.

## Why phased

Phase 1 is one evening of work. Phase 2 is a week of careful infrastructure. Phase 3 is
two more weeks of Stripe + abuse handling. Going straight to Phase 3 risks shipping a
billing system for a feature that turns out not to be compelling. Phase 1 tells us that
in days, not months.

## Security note

A reminder that landed us on this plan: **API keys cannot be safely embedded in a Chrome
extension.** Anyone who installs it can read the bundle, intercept network requests, and
extract the key. Encryption doesn't help — the decryption code ships with the bundle.

That's why our key only ever lives behind a server (Phase 2/3) and the user's key only
ever lives on the user's own machine (Phase 1). We never ship a key inside the extension.
