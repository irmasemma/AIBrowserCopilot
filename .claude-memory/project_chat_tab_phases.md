---
name: Chat Tab — Phased Build Plan + Strategic Pivot
description: Chat tab is now the headline product (not the MCP server). Phase 1 shipped, Phase 1.5 deferred, Phase 2 is the next monetization unlock.
type: project
originSessionId: 4b9bf318-ef3a-4d9f-b709-dff4f9d20c43
---
The side panel now has a tabbed UI with **Chat as the default tab**, plus Tools and Settings. The chat is an in-extension OpenAI agent that drives the existing tool dispatcher (same dispatcher MCP uses).

**Strategic positioning (decided 2026-04-30 after deep browsermcp comparison):**
The product direction is **chat-first**, not MCP-server-first. We can't beat browsermcp on MCP setup UX (they have zero install — `npx`); trying to is a Sisyphus task. But the chat tab doesn't compete with browsermcp at all — browsermcp users still need a paid Claude Code/Cursor subscription, CoPilot's chat is the alternative to that. Different category, our own moat.

**Phasing (binding for Phase 2/3 scope):**
- **Phase 1 — user-supplied key.** Shipped 2026-04-29. Locked to gpt-4o-mini 2026-04-30. Zero backend. Validates demand.
- **Phase 1.5 — multi-provider (Anthropic, Gemini).** Explicitly deferred. Don't start unless a user asks. Today, pasting an Anthropic key fails silently with a 401 from OpenAI — known UX bug, not yet fixed.
- **Phase 2 — free-tier proxy on owner's key.** Cloudflare Workers + KV. Token-budget per user (~30k input + 6k output / day, NOT request count — request count is gameable). License-token auth tied to existing `useLicense`. **This is the next monetization unlock — build it after Phase 1 has real users.**
- **Phase 3 — Stripe pay-as-you-go credits.** Prepaid balance topped up via Stripe Checkout, decremented per request by actual OpenAI cost + small markup.

**Adjacent work to make chat win on form filling (post-Phase 1 quality bar):**
- Route every `fill_form` through `playwright-crx` (drop the simple-path branch in `tool-dispatcher.ts`). Same library browsermcp uses; gets framework-state handling and auto-waiting for free.
- Expose Playwright's `_snapshotForAI()` as a tool (ARIA accessibility tree). Lets the chat agent target fields by accessible name instead of CSS selectors — the model browsermcp uses.
- Auto-include a brief snapshot in `fill_form`/`click_element` responses so the agent sees what changed without a separate `read_form` call.

**Hard rules:**
- **Never embed an API key in the extension bundle.** Owner asked; rejected because extensions are user-readable. Owner's key only ever lives behind a server (Phase 2/3); user's key only ever on user's machine (Phase 1).
- For Phase 2 rate-limiting: tokens, not requests. Show users their remaining budget so throttling is legible.
- Don't suggest Phase 3 work until Phase 2 has shipped and Phase 1 has clear engagement metrics.
- Don't invest in the MCP installer UX. Replace "auto-detect AI tools and write configs" with a "Copy MCP config snippet" button. The 5% of users who care will copy/paste; everyone else gets the chat.

**How to apply:**
- Full plan: `ai-browser-copilot/docs/chat-tab-plan.md` — read before any chat-tab work.
- Strategic comparison with browsermcp: see `project_browsermcp_comparison.md`.
