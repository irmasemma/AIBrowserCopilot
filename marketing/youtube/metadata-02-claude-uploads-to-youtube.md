# AgentHub — YouTube package · demo: "Claude uploaded this video to YouTube, hands-free"
_By the seo-specialist agent. Fill in `{{CHROME_STORE_URL}}` (2 spots) before publishing._

Thumbnail: `marketing/AgentHub-youtube-thumbnail.png` (+ `.jpg`) — 1280×720, 24-bit, no alpha.
(Earlier generic version kept as `AgentHub-youtube-thumbnail-generic.png`.)

## Title (pick one)
1. **I Let Claude Upload This Video to YouTube (Hands-Free)** ← recommended (54 chars — the meta payoff is the hook; true, high CTR)
2. Browser MCP: Claude Uploads to YouTube by Itself — (48) keyword-front-loaded A/B partner
3. AgentHub Lets Claude Drive Your Real Logged-In Browser — (54) product-led variant
_Launch with #1; if search impressions lag, swap to #2._

## Description
**First ~150 chars (before "…more"):**
Claude uploaded THIS video to YouTube by itself — hands-free. I just asked in Claude Code. Get AgentHub: {{CHROME_STORE_URL}} — then run: npx agenthub-setup@latest

**Body:**
No API keys. No OAuth. No copy-paste. In this 65-second demo I open Claude Code and type one request — "upload this video to YouTube with a title and description" — and Claude does the rest, driving my real, already-logged-in Chrome: it opens YouTube Studio, uploads the file, types the title and description, and hits Publish. The kicker: the very video you're watching was published by Claude itself.

It works through AgentHub, a Chrome extension that turns your browser into MCP (Model Context Protocol) tools your AI can call. Install it, run `npx agenthub-setup@latest`, and it auto-detects your MCP client — Claude Code, Cursor, or Claude Desktop — and wires up a local bridge. No config files, no account. From there your AI can read open tabs, fill React/Vue/shadow-DOM forms, click, type, scroll, navigate, take screenshots and accessibility snapshots, and extract page data — all inside your actual logged-in session.

Because it drives the browser UI (not a hidden API), it works on sites that have no API at all. And it's private by design: the bridge runs on localhost (127.0.0.1), it's not network-reachable, nothing is stored on a server, site access is opt-in and revocable, banking/email domains are blocked by default, and every tool call shows in the side-panel activity log.

**What AgentHub can do**
- 🧠 Exposes your browser as MCP tools for Claude Code / Cursor / Claude Desktop
- 📤 Uploads files & fills forms (React, Vue, shadow-DOM) hands-free
- 🖱️ Clicks, types, presses keys, scrolls, navigates back/forward
- 👀 Reads full page content, metadata, tables & structured data
- 📸 Takes accessibility snapshots and screenshots
- 🔒 localhost-only bridge, opt-in site access, activity log, no account

**Get started**
1. Install AgentHub from the Chrome Web Store → {{CHROME_STORE_URL}}
2. Run `npx agenthub-setup@latest` in your terminal
3. Ask your AI to do something in your browser

**Chapters**
```
0:00  The ask — one line in Claude Code
0:08  Claude opens YouTube Studio
0:20  Uploads the video file
0:33  Types the title & description
0:48  Claude hits Publish
0:58  …and this video was uploaded by Claude
```
Requires Chrome/Edge 120+ and an MCP client. Uses Chrome's "debugger" permission (Chrome DevTools Protocol).

**#BrowserMCP #ClaudeCode #MCP #AIautomation #AgentHub**

## Tags (15, ≤500 chars)
AgentHub, browser MCP, Claude browser automation, Claude Code, upload video to YouTube with AI, Claude uploads to YouTube, automate YouTube Studio, MCP tools, Model Context Protocol, AI browser agent, Chrome extension MCP, hands-free YouTube upload, Claude Code tutorial, AI automation, Anthropic Claude

## Thumbnail
Headline: **CLAUDE UPLOADED THIS** (alts: "AI HIT PUBLISH", "HANDS-FREE UPLOAD").
Big red YouTube play button + "✓ Published to YouTube", real Claude Code reasoning + AgentHub activity log, MCP/localhost chips. YouTube red + near-black + Claude terracotta accent.
