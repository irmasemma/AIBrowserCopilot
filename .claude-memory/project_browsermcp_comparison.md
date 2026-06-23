---
name: browsermcp vs CoPilot — architectural comparison and strategic takeaway
description: browsermcp wins first-time setup; CoPilot wins day-2 reliability. Don't compete with browsermcp on MCP UX — pivot to chat-first.
type: project
originSessionId: 4b9bf318-ef3a-4d9f-b709-dff4f9d20c43
---
Done a deep read of github.com/browsermcp/mcp on 2026-04-30. The strategic and architectural takeaways below are durable across future planning sessions.

## browsermcp's architecture (4 files of code)

- **MCP server** is just `npx @browsermcp/mcp@latest` — no installer, no native messaging, no per-OS binary. AI tool spawns it via stdio per the standard MCP child-process pattern.
- **Transport to browser**: WebSocket on a fixed localhost port. The server `killProcessOnPort` on startup, then binds. See [src/ws.ts](https://github.com/BrowserMCP/mcp/blob/main/src/ws.ts).
- **Pairing**: Chrome extension has a single visible **"Connect" button**. User clicks → extension opens `ws://localhost:<port>` → paired. No auto-discovery, no token, no lock file.
- **Tool model**: every action returns a fresh **ARIA snapshot** (Playwright's `_snapshotForAI()`-equivalent). Agent sees the page as a small semantic tree (~1-2 KB) with `ref` IDs. Tools take `element: "Submit button", ref: "s1e23"` instead of CSS selectors.
- **Single-tab focus**: extension is bound to whichever tab the user clicked Connect on. No multi-tab addressing.
- **No reconnect logic**: when WS dies, tools throw "click the Connect button". User-driven recovery.

## Where browsermcp wins decisively

- **First-time setup UX**: paste 4-line config snippet, click Connect, done. CoPilot requires installer + Chrome restart + AI tool restart and still misses the AI-client config write on many setups.
- **Cross-platform from day one**: no per-OS binary.
- **Form filling**: ARIA-snapshot-plus-Playwright is fundamentally better than CSS-selector-first. Auto-snapshot return after every action means the agent always sees the consequence (validation errors, new fields, button enable/disable).
- **Code surface**: connectivity is ~50 lines vs. CoPilot's 2000+ across native-host/installer/connection-manager/etc.

## Where CoPilot wins (real, not just theoretical)

- **Multi-tab**: every tool takes `tab_id`; `list_tabs` exists. browsermcp can't address tab 2 from tab 1.
- **Day-2 reliability**: lock file + token + service discovery + backoff means most failures self-heal (Chrome restart, AI-tool restart, native host crash). browsermcp requires manual Connect click after any disconnect.
- **Edge-case form features**: iframe targeting, file upload (`setInputFiles`), date pickers, contenteditable, ARIA widgets (slider/switch/combobox). Playwright supports all this; browsermcp just hasn't exposed the tools.
- **Structured data extraction**: heuristic detection of card grids, listings, etc. via `extract_data`. browsermcp has nothing equivalent.

## Connection lifecycle quick-reference

| Scenario | browsermcp | CoPilot |
|---|---|---|
| New chat, same Claude session | works (server alive, WS alive) | works |
| Restart Claude Code | requires Connect click | auto-reconnects via lock file |
| Two AI tools running simultaneously | second kills first | lock file singleton — last writer wins, similar issue |
| Chrome restart | requires Connect click | auto-reconnects on SW startup |

## Strategic takeaway

**Don't try to beat browsermcp at MCP-server-for-external-AI.** They're already in claude.ai's Connectors panel; setup is one paste; we can't catch up without becoming them. Chat tab is the differentiation that doesn't compete with them at all — see `project_chat_tab_phases.md`.

**What to copy from them, eventually**: the ARIA snapshot tool model. Same library (Playwright). Make the chat agent reliably better at form filling without a transport rewrite.

**What NOT to copy**: the WebSocket-on-fixed-port + manual Connect transport. CoPilot's existing transport is more complex but actually wins on day-2 UX, which matters more once a user is past first-time setup.

## Concrete state on this developer's machine (as of 2026-04-30)

- CoPilot is **registered for VS Code only**: `c:\Dev\1M\pilotwave\.vscode\mcp.json` exists with `pilotwave` entry pointing at `packages/native-host/dist/index.js` (dev path, not the production `.exe`).
- CoPilot is **NOT registered for Claude Code** in either `~/.claude.json` (empty mcpServers) or `c:\Dev\1M\.mcp.json` (only browsermcp). That's why `claude mcp` doesn't list it. The installer's Claude Code detector probably failed at install time (Claude Code not yet installed when installer ran, or `claude` not on PATH then). No retry surface in the extension.
- Chrome native-messaging registry is correctly populated (`com.pilotwave.native_host`, `com.pilotwave.native_host_helper`).
- `browsermcp` (the third-party product, `@browsermcp/mcp` from npm) is also configured at `c:\Dev\1M\.mcp.json` — confusingly similar name, completely separate codebase.
