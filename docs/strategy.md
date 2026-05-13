# Strategic Positioning & Architecture Decisions

Captured 2026-04-30. Distilled from a deep architectural comparison with
[github.com/browsermcp/mcp](https://github.com/browsermcp/mcp) and a strategic conversation
about where CoPilot competes and where it doesn't.

## TL;DR

1. **Pivot to chat-first.** The headline product is the in-extension chat tab, not the
   MCP server. CoPilot can't beat browsermcp on MCP setup UX without becoming them.
2. **The chat tab doesn't compete with browsermcp.** browsermcp users still need a paid
   Claude Code/Cursor subscription to drive their browser. CoPilot's chat is the
   alternative to that subscription.
3. **Stop investing in the MCP installer UX.** Replace auto-detection + config-writing
   with a single "Copy MCP config snippet" button. The 5% of users who care will paste;
   everyone else gets the chat.
4. **Adopt browsermcp's ARIA snapshot tool model for the chat agent.** Same library
   (Playwright). Closes the form-fill quality gap without a transport rewrite.
5. **Phase 2 (free-tier proxy) is the next monetization unlock.** Cloudflare Workers,
   token-budget rate limiting, license-token auth.

## Why we can't beat browsermcp at MCP-server-for-external-AI

browsermcp's setup UX is fundamentally simpler:

- One npm package (`@browsermcp/mcp`). No installer, no native messaging, no per-OS
  binary, no Chrome restart.
- WebSocket on a fixed localhost port (~50 lines of code total for the connectivity
  layer).
- Single visible "Connect" button in their Chrome extension. Pairing is explicit and
  user-driven.
- They're already listed in claude.ai's Connectors panel.
- ARIA snapshot tool model (adapted from Microsoft's Playwright MCP) is genuinely
  better for LLM agents than CSS-selector-first.

CoPilot picked the opposite tradeoffs — native-host binary, native messaging registry +
manifests, lock file + auth token, auto-pairing via service discovery, multi-tool
installer wizard with detectors. Each had a reason (security, no manual click,
multi-tool config writing) but cumulatively the setup is brittle.

This isn't fixable by polishing the installer. browsermcp avoided every CoPilot setup
problem by **not having an installer at all**.

## Where CoPilot still wins

These are real, not theoretical:

| Capability | browsermcp | CoPilot |
|---|---|---|
| One agent driving multiple tabs | ❌ (single Connect tab) | ✅ (`tab_id` on every tool, `list_tabs`) |
| Day-2 reliability after Chrome / AI-tool restart | ❌ (manual Connect) | ✅ (lock file + service discovery + reconnect) |
| iframe form fill | ❌ | ✅ |
| File upload, date pickers, contenteditable, ARIA widgets | ❌ | ✅ |
| Heuristic structured data extraction (`extract_data`) | ❌ | ✅ |

browsermcp's gaps on form features aren't because Playwright can't do them — they
chose a minimal tool set. CoPilot exposed more.

## Connection lifecycle comparison

| Scenario | browsermcp | CoPilot |
|---|---|---|
| New chat, same Claude Code session | works | works |
| Restart Claude Code | requires manual Connect click | auto-reconnects via lock file |
| Two AI tools running simultaneously | second `killProcessOnPort`'s the first | lock file singleton — last writer wins |
| Chrome restart | requires Connect click | auto-reconnects on SW startup |

This is the one area where CoPilot's complexity actually pays off. **browsermcp wins
first-time setup; CoPilot wins day-2 reliability.** Most products live or die on
first-time setup, which is why browsermcp's UX feels better — but for power users who
restart their AI tool more than once a day, CoPilot's self-healing is a real advantage.

## Strategic decision: chat-first

**The chat tab (Phase 1, shipped 2026-04-29) is the product going forward.**
Reasoning:

- It doesn't compete with browsermcp at all — different category.
- It already inherits multi-tab + extract_data + form fill from the existing tool
  dispatcher. We didn't rebuild the tool layer.
- Monetization path is clearer: free-tier proxy on our key, then Stripe credits. Both
  in [chat-tab-plan.md](./chat-tab-plan.md).
- browsermcp users still need a Claude Code or Cursor subscription. CoPilot's chat
  is what they'd switch to if they didn't want that.

## Concrete next steps (not started, in priority order)

1. **Demote MCP, don't invest more.** In Settings, replace any "auto-detect AI tools"
   ambition with a **"Copy MCP config snippet"** button that produces the right JSON
   for the user's chosen tool. One screen, no detection, no auto-write.

2. **Make the chat tab match browsermcp on form fill quality.**
   - Route every `fill_form` through `playwright-crx` (drop the simple-path branch in
     `tool-dispatcher.ts`). Same library browsermcp uses; gets framework-state
     handling and auto-waiting for free.
   - Expose Playwright's `_snapshotForAI()` as a tool. Lets the chat agent target
     fields by accessible name instead of CSS selectors.
   - Auto-include a brief snapshot in `fill_form`/`click_element` responses so the
     agent sees what changed without a separate `read_form` call.

3. **Phase 2 — free-tier proxy.** Cloudflare Workers + KV. Token-budget per user
   (~30k input + 6k output / day, NOT request count — gameable). License-token auth
   tied to existing `useLicense`. See [chat-tab-plan.md](./chat-tab-plan.md).

4. **Phase 3 — Stripe pay-as-you-go credits.** Only after Phase 2 has shipped and
   Phase 1 has clear engagement metrics.

## What we explicitly chose NOT to do

- **Don't refactor away from native messaging right now.** Despite browsermcp's
  simpler transport, CoPilot's existing transport actually wins on day-2 reliability.
  Premature to rewrite for users we don't yet have.
- **Don't try to get listed in claude.ai's Connectors panel.** That's the browsermcp
  lane. Their relay-based architecture (cloud server with persistent WS to the
  extension) is a meaningfully different product, not a polish step.
- **Don't chase the installer-detection bugs.** Every fix exposes another OS, another
  AI client, another config-file edge case. Replace with the snippet button.
- **Don't add Anthropic / multi-provider support speculatively.** Phase 1.5 is
  deferred until a user actually asks. Today, pasting an Anthropic key fails silently
  with a 401 from OpenAI — known UX bug, not yet fixed.

## Hard rules carried forward

- **Never embed an API key in the extension bundle.** Chrome extensions are
  user-readable and any embedded key gets scraped within days.
- **For Phase 2 rate-limiting**: tokens, not requests. Show users their remaining
  budget so throttling is legible.
- **Don't suggest Phase 3 work** until Phase 2 has shipped and Phase 1 has clear
  engagement metrics.

## Case study (2026-05-05): the registration that vanished

A working installation went silent. `chrome://extensions` showed CoPilot enabled,
the side panel said "Not Connected", and `claude mcp list` did not list
`pilotwave`. The user's reasonable belief was "it worked yesterday."

**Root cause:** the registration *did* exist. A backup at
`~/.claude.json.backup-20260330-230259` proved that `~/.claude.json` had
`projects."C:/Dev/1M".mcpServers.pilotwave` pointing at
`node .../packages/native-host/dist/index.js`. On 2026-05-05 at 16:05, the file
was modified and shrunk by 5,297 bytes — the entry was removed. We don't know
*who* removed it (a `claude mcp` command, a manual edit, an auto-prune), but
the failure mode is clear: **someone else's tool can rewrite our registration
out from under us, and there is no recovery path inside the extension UI**.

Two compounding bugs made it worse:

1. The entry was at **project scope** (`projects.<dir>.mcpServers`), not user
   scope (top-level `mcpServers`). Project-scope entries are easier for `claude
   mcp` and Claude Code's bookkeeping to drop silently, and they're invisible
   the moment the user `cd`s elsewhere.
2. The `command` was `node .../dist/index.js` — a **dev path** that requires
   `node` on PATH and a build to be present. Both the deleted entry and the
   `.vscode/mcp.json` on this developer's machine had the same wrong shape,
   pointing at "however this developer hand-set things up while testing,"
   not "the production install layout the installer would write."

## The robust install pattern (locked in)

Implemented across all detectors in `packages/installer/src/detectors/*.ts` and
in the native-host helper's self-heal action.

1. **Always register at user scope, never project scope.** Top-level
   `mcpServers` (Claude Code, Claude Desktop, Continue, JetBrains) or top-level
   `mcp.servers` (Cursor, VS Code, Windsurf, Zed). Project-scope is a non-goal
   unless the user explicitly opts in.
2. **Use the production `.exe` path in `%LOCALAPPDATA%/pilotwave/`,
   never a dev `node .../dist/index.js`.** The dev path is fragile (requires
   PATH, requires a build) and routinely breaks for real users. The native-host
   helper now derives the correct binary path from its own install dir at
   runtime via `getNativeHostBinaryPath()`.
3. **Verify the entry survived after every write.** `verifyWrite` only checked
   that the file parsed as JSON, which doesn't catch the failure mode where a
   merge silently drops our entry. New `verifyEntryAtPath(filePath, jsonPath)`
   actually walks to the entry and confirms it exists. Every detector's
   `verifyConfig` now uses it.

## The self-heal pattern (locked in)

Lives in `packages/native-host-helper/src/mcp-registrar.ts` and is exposed to
the extension via two new native-messaging actions:

- `check_mcp_registration` — reads `~/.claude.json`, returns whether
  `pilotwave` is registered, at what scope (`user` | `project` | null),
  whether the production binary exists.
- `repair_mcp_registration` — writes the entry to **user scope** with the
  production `.exe` path, backs up the existing config first, then verifies the
  entry survived (calls `check_mcp_registration` internally and refuses to
  return success if the entry isn't there post-write).

The Settings tab calls `check_mcp_registration` on mount and renders one of
three cards:

- **Registered (user scope)** — quiet "✓ Registered with Claude Code" line.
- **Registered (project scope)** — amber card warning that project-scope is
  fragile, with a "Move to user scope" button that runs repair.
- **Not registered (but `~/.claude.json` exists)** — amber card explaining what
  happened, with a "Re-add to Claude Code" button that runs repair.
- **Config doesn't exist** — silent (the user hasn't run Claude Code yet).

This means a future "someone removed our entry" event becomes a one-click fix
instead of a dead-end. The user opens the side panel, clicks Re-add, restarts
their AI tool. No installer re-run, no manual JSON editing, no support thread.

## What this still doesn't fix

- **Other AI clients (Cursor, Windsurf, etc.).** The self-heal action currently
  only handles Claude Code. Same pattern can be repeated per-client when
  someone reports the same symptom there. Don't pre-build it.
- **The native-host binary going missing.** The repair button refuses to write
  the registration if the binary doesn't exist at the expected path. In that
  case the user still has to re-run the installer. The card surfaces this
  clearly rather than writing an entry that points at a non-existent file.
- **The user being on a fresh machine where `~/.claude.json` doesn't exist
  yet.** The card stays silent in that case (no notification) — the assumption
  being "if you don't have Claude Code, you don't care about Claude Code MCP
  registration." If we ever want to nudge users *toward* installing Claude
  Code, that's a different feature.
