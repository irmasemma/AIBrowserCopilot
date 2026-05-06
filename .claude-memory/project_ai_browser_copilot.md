---
name: AI Browser CoPilot Project Status
description: Chrome extension bridging browser to AI via MCP — connection layer redesign in progress (18 stories, 15/18 done), 435+ tests across 4 packages, multi-browser support added.
type: project
---

## Product
- "AI Browser CoPilot" Chrome extension connecting professionals to AI via MCP
- **Target market: business/non-technical users** (sales, marketing, SEO, ops) — NOT developers. Developer-facing MCP was first available distribution channel, not the intended audience.
- Paid-first freemium: 3 free tools, 5 Pro tools. **Pricing: $15/mo** (updated 2026-04-04, market supports $15-50/mo for business automation tools)
- **Core value proposition (2026-04-04):** AI-powered data extraction + form filling across AUTHENTICATED web apps. The auth advantage is the moat — no scraper can access logged-in Salesforce, internal tools, government portals.
- AI-agnostic: works with Claude Desktop, Claude Code, VS Code, Cursor, Windsurf, JetBrains, Zed, Continue.dev
- **Strategic direction (2026-04-01 research):** Multi-protocol architecture to reach ChatGPT (60.4%) and Gemini (15.2%) users, not just Claude/Cursor ecosystem (~4.5%). See `_bmad-output/planning-artifacts/strategic-pivot-ai-browser-copilot-2026-04-01.md`

## Current Status (2026-03-31)
- **Connection layer redesign IN PROGRESS** — 15 of 18 stories completed
- **435+ tests** across 4 packages (extension 153, native-host 21, installer 257, NM helper 4)
- **New package:** `packages/native-host-helper/` — NM discovery helper binary
- **Published:** npm (ai-browser-copilot-setup@0.1.2), GitHub releases v0.2.0
- Code: `C:\Dev\1M\ai-browser-copilot\`
- Monorepo: `packages/extension` + `packages/native-host` + `packages/installer` + `packages/native-host-helper`

## Connection Layer Redesign (2026-03-31)
**Why:** 11 bugs found on 2026-03-30 (3 critical) traced to 5 missing architectural pieces. Research evaluated 4 patterns (Native Messaging, WebSocket, Hybrid, KeePassXC Proxy). Decision: hardened WebSocket with state machine.

**Architecture Addendum:** `_bmad-output/planning-artifacts/architecture-connection-addendum.md` (AD-1 through AD-11)
**Research:** `_bmad-output/planning-artifacts/research/technical-robust-connection-management-research-2026-03-31.md`
**Epics:** `_bmad-output/planning-artifacts/epics-connection-addendum.md` (4 epics, 18 stories)

**New modules implemented:**
- `connection-machine.ts` — 6-state FSM (disconnected/connecting/connected/degraded/reconnecting/error)
- `backoff-manager.ts` — gRPC-spec exponential backoff + circuit breaker (5 failures, 60s half-open)
- `heartbeat-monitor.ts` — 20s ping/pong, 3 miss = dead
- `connection-manager.ts` — orchestrator tying FSM + relay + heartbeat + backoff
- `relay-client.ts` — REWRITTEN as thin WebSocket wrapper (no internal state/reconnection)
- `service-discovery.ts` — reads lock file via NM helper sendNativeMessage
- `tool-scanner.ts` — processes scan results, badge notifications
- `lock-file-manager.ts` — PID/port/token lock file with orphan detection
- `ai-tool-scanner.ts` — scans 8 AI tool config paths
- `browser-registrar.ts` — multi-browser NM registration (Chrome, Edge, Brave, Arc, Vivaldi)
- UI: `diagnostics-panel.tsx`, `tool-list.tsx`, `setup-prompt.tsx`, updated `status-badge.tsx`, `connection-header.tsx`, `store.ts`

**Remaining (3 stories):**
- C4.3: Uninstall multi-browser — function written, needs wiring into uninstall()
- C3.6 fallback scan + C4.3 uninstall wiring — minor integration work
- `background.ts` needs updating to use new connection-manager instead of old relay-client imports

## Architecture
- Extension: Manifest V3, WXT, Preact + Zustand + Tailwind
- Native Host: Node.js MCP server, esbuild + pkg to binary
- Connection: **WebSocket with 6-state FSM, lock file discovery, dynamic port, token auth**
- NM Helper: Lightweight binary for lock file reads + tool scans (sendNativeMessage one-shot)
- Installer: React + Ink CLI, downloads binary, registers NM for ALL detected browsers

## Key Differentiator (vs Puppeteer/CDP tools like browsermcp)
- Works inside user's REAL browser — their tabs, cookies, logged-in sessions
- No separate Chromium instance — zero resource overhead
- User sees every action, activity log, per-tool toggles, domain blocking

## Connection Flow (NEW — redesigned)
- Native host starts → checks lock file for existing instance → finds available port (prefer 7483, fallback dynamic) → generates auth token → writes lock file → starts WebSocket server
- Extension wakes → calls NM helper to read lock file → gets port + token → connects `ws://127.0.0.1:<port>?token=<hex>` → receives server_info handshake → state: connected → heartbeat starts (20s)
- Lost connection → state machine: reconnecting → gRPC backoff (1s/1.6x/30s max) → circuit breaker (5 fails → error, 60s half-open)
- Lock file: `%LOCALAPPDATA%\ai-browser-copilot\server.lock` (Win) / `~/Library/Application Support/ai-browser-copilot/server.lock` (Mac)

## MCP Tools (8 total)
Free tier: `get_page_content`, `take_screenshot`, `list_tabs`
Pro tier: `get_page_metadata`, `navigate`, `fill_form`, `click_element`, `extract_table`

## Build & Test
- Extension: `cd packages/extension && npx vitest run` (153 tests)
- Native host: `cd packages/native-host && npx vitest run` (21 tests)
- Installer: `cd packages/installer && npx vitest run` (257 tests)
- NM helper: `cd packages/native-host-helper && npx vitest run` (4 tests)
- All: `npm run test --workspaces --if-present`

## npm account
- Username: tech.mom_us
- Package: ai-browser-copilot-setup (public)

## What's Left to Launch
1. **Finish connection wiring** — update background.ts to use connection-manager, wire uninstall multi-browser
2. **Epic 6: Payment provider** (ExtensionPay or Dodo) — Pro license verification, activation at **$15/mo**
3. Code-signing certificates (currently unsigned → SmartScreen warning)
4. CWS + Edge submission (listing copy — reposition for business users, not developers)
5. Landing page + demo video (lead with data extraction + form filling use cases)
6. Launch marketing (Product Hunt, Reddit — target r/smallbusiness, r/sales, r/marketing, not just r/ClaudeAI)

## Post-Launch Priorities (2026-04-04 Strategic Direction)
1. **Data extraction templates** — one-click extraction of tables, contacts, product data from authenticated apps
2. **Cross-tab data transfer** — extract from Tab A → fill form in Tab B
3. **HTTP/SSE MCP transport + Cloudflare Tunnel** — reach ChatGPT users (60.4% market), $0 infra cost
4. **Monitoring / change detection** — sticky recurring value
5. **WebMCP support** — reach Gemini users (15.2%, fastest growing) when Chrome 146 stable
6. **CLI transport** — token-efficient local agent access

## Known Issues
- `background.ts` still imports old relay-client — needs switching to connection-manager
- Native host binary unsigned (SmartScreen warning on Windows)
- Extension typecheck error on `defineBackground` — WXT auto-import, not a real bug
