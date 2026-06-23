# Chrome Web Store Listing

## Extension Name
AgentHub — AI Chat + MCP for Claude, Cursor, and ChatGPT

## Short Description (132 chars max)
AI sidebar + MCP bridge for your browser. Let Claude, Cursor, ChatGPT, Gemini read tabs, fill forms & extract data in real Chrome.

*(131 chars)*

## Detailed Description

**Your AI, your browser. AgentHub lets your favorite AI assistant actually use your tabs, sessions, and logins — not a sandboxed demo, your real Chrome.**

AgentHub is two things in one extension:

1. **A chat sidebar** in Chrome where you talk to OpenAI, Anthropic Claude, or Google Gemini directly — using your own API keys, all stored locally, never sent to our servers.
2. **An MCP bridge** that exposes your browser as a tool source for Claude Code, Cursor, Claude Desktop, and any other MCP-compatible AI client.

Either way, your AI can read pages, list and switch tabs, take screenshots, fill forms, click elements, extract tables, and pull structured data — all from inside the browser you already use.

---

### What you can do with it

**Research, faster.** "Summarize this 60-page docs site." "Pull every job title from this LinkedIn profile into a table." "What's the pricing across all three competitor tabs I have open?"

**Forms, without copy-paste.** "Fill this Salesforce lead with Jane's info from the tab next to me." "Apply to this job using my resume in tab 2." "Submit this contact form with the values from my CSV."

**Cross-tab orchestration.** Your AI can list every tab you have open, switch between them, read the content of each, and combine results. "Find Jane's email in tab 1, her company's last funding round in tab 2, and fill them into the notes here in tab 3."

**Extract anything.** Tables, lists, contacts, prices, reviews, articles — into JSON, markdown, or whatever format you ask for.

**Drive your IDE from the browser, and vice versa.** With MCP enabled, the AI agent running in your terminal can ask the browser questions ("what's on the user's screen?") and act on the answers ("open this URL", "fill this form").

---

### Supported AI tools

**Chat tab (use your own API key, stored locally):**
- OpenAI — GPT-4.1, GPT-5, o3, o4-mini
- Anthropic — Claude Opus, Sonnet, Haiku
- Google Gemini — Gemini 2.5 Pro, Flash, Flash-Lite
- Custom model IDs supported via the "Custom…" option

**MCP bridge (works alongside the chat tab, or instead of it):** Claude Code, Cursor, and Claude Desktop are tested and documented out of the box. Any other MCP-compatible AI client works too — we register through the standard Model Context Protocol, so new clients work without changes to the extension. The full tested-client list is in our setup screenshot and on GitHub.

---

### Browser tools your AI gets

| Tool | What it does |
|---|---|
| `get_page_content` | Read text from any page |
| `take_screenshot` | Capture what you see |
| `list_tabs` | See every tab open across windows |
| `get_page_metadata` | Page title, description, OG tags |
| `navigate` | Open or move to a URL |
| `fill_form` | Auto-fill form fields (React, Vue, Lit, plain HTML, shadow DOM) |
| `click_element` | Click buttons, links, controls — by text, selector, or index |
| `press_key` | Submit forms or trigger keyboard shortcuts |
| `extract_table` | Pull HTML tables as structured rows |
| `read_form` | Inventory every input on a form |
| `extract_data` | Heuristic detection of structured data on a page |

Every tool can be toggled on or off per your preference. Sensitive domains (banking, email) are blocked by default.

---

### Why AgentHub

- **Your real browser, your real data.** Other "AI browsers" run inside a fresh Chromium with no cookies, no logins, no extensions. AgentHub uses your actual Chrome profile — your Gmail is logged in, your Slack is there, your saved passwords work.
- **One bridge, every tool.** Most "browser-for-AI" extensions are locked to one AI tool. AgentHub is one bridge that any MCP-compatible AI can use. Add a new AI to your stack tomorrow without reinstalling anything in the browser.
- **Your keys, your machine.** API keys for the chat tab live in `chrome.storage.local`. They never leave your device. There is no backend, no telemetry, no account.
- **Free, fully open source.** No pro tier, no waitlist, no upsell. Source at github.com/irmasemma/AIBrowserCopilot.
- **Privacy-first defaults.** Banking and email domains blocked out of the box. Real-time activity log shows every tool call your AI makes, with which URL, with which result. Per-tool permission toggles.
- **Works with multiple Chrome profiles** at once. Each profile gets its own namespaced tab IDs so an AI driving two profiles never confuses them.

---

### How to install

1. Install AgentHub from the Chrome Web Store (this page).
2. Run the one-command setup in any terminal:
   ```
   npx agenthub-setup@latest --extension-id <YOUR_ID_FROM_THE_SIDE_PANEL>
   ```
3. The installer detects your AI tools (Claude Code and others) and registers AgentHub with each automatically.
4. Open your AI tool and ask it about the page you're on. Or open the AgentHub sidebar and chat directly.

That's it. No account. No waitlist.

---

### Privacy & security

- **No backend.** Everything runs locally between your browser and your AI tool. There are no AgentHub servers.
- **No telemetry.** We don't collect usage data. The activity log lives in your browser only.
- **Local API keys.** Chat-tab keys go to `chrome.storage.local`. They never touch our servers because there are no servers.
- **Activity log.** Every tool call your AI makes is logged — what tool, on which URL, when, success or failure, with what duration. Visible in the side panel.
- **Per-tool toggles.** Disable any tool any time. If you turn off `fill_form`, no AI can fill forms — even if it asks.
- **Domain blocking.** Default-deny on banking and email domains. Configurable.
- **Native messaging.** Browser ↔ AI communication uses Chrome's native messaging API (the same mechanism password managers and YubiKey use) — no open ports, no network sockets.
- **Open source.** Read the code, audit the manifest, build it yourself.

---

### Requirements

- Chrome 120+ or Edge 120+
- Node.js 18+ (one-time install via `npx agenthub-setup` — the bridge itself is a compiled binary after that, no Node needed at runtime)
- One of the supported AI tools, **or** an API key for OpenAI / Anthropic / Gemini if you want to use the in-extension chat

---

### FAQ

**Is this free?**
Yes, fully. No pro tier, no trial, no upsell. The setup installer (`agenthub-setup`) and the bridge binary are open source on GitHub.

**Does my data go anywhere?**
No. There is no AgentHub server. Browser ↔ AI communication is 100% local via native messaging. API keys for the chat tab are stored in `chrome.storage.local` and never leave your machine. The activity log is local.

**Which AI tools work with this?**
Out of the box: Claude Code, Cursor, and Claude Desktop. Plus OpenAI, Anthropic, and Gemini direct from the chat sidebar. Any other MCP-compatible AI tool works too — we use the standard protocol. The full tested-client list lives in our promotional screenshots and on GitHub.

**Do I need an API key?**
For the in-extension chat sidebar: yes, you bring your own key for OpenAI, Anthropic, or Gemini. For the MCP bridge to external AI tools: no, those tools handle their own auth — AgentHub just exposes the browser as a tool source for them.

**Is this safe to install?**
The extension code is open source. The native bridge is a small, audited binary that only talks to your local browser over Chrome's native messaging API — no network sockets, no open ports. Sensitive domains (banking, email) are blocked by default. Every tool can be disabled with a single toggle. Every AI action is logged.

**What's different from {other AI browser extension}?**
Most AI browser extensions either (a) run a separate sandboxed Chromium without your cookies and logins, or (b) lock you to a single AI provider. AgentHub uses your real Chrome (so your Gmail, Slack, paid SaaS subscriptions all work) AND is provider-agnostic — one install works with every major AI tool you use.

**Does it work with multiple Chrome profiles?**
Yes. Each profile gets a namespaced browser ID so an AI driving two profiles at once never confuses them. Tab IDs returned by `list_tabs` are scoped per profile.

**What about Edge / Brave / Arc / Vivaldi?**
Edge: yes, same .zip works. The installer auto-detects and registers with Edge too. Brave / Arc / Vivaldi: the bridge installs registry entries for them too, but the AgentHub extension itself currently ships through Chrome Web Store + Edge Add-ons. Side-load builds work on Chromium-based browsers.

**Where do I report a bug or request a feature?**
GitHub issues: https://github.com/irmasemma/AIBrowserCopilot/issues

---

## Category
Productivity

## Language
English

---

## Permissions Justification

### host_permissions: <all_urls>
Required so the AI assistant can read page content, take screenshots, fill forms, click elements, and extract table data on any website the user is viewing. Tool invocations are programmatic (triggered by the AI, not by a user click), so activeTab alone is insufficient. Users control which tools are enabled via toggles in the side panel, and sensitive domains (banking, email) are blocked by default.

### tabs
Required for the "List Tabs" tool, which lets the AI assistant see what tabs are open to help the user navigate. Also used for the "Navigate" tool to update the active tab's URL.

### sidePanel
Required to display the extension's control panel where users can see connection status, toggle tool permissions, and view the real-time activity log.

### nativeMessaging
Required to communicate with the local native messaging host (the MCP bridge). This is the core mechanism that connects the browser to the AI assistant. All communication is local — no network requests are made.

### scripting
Required to execute content scripts that read page content, extract metadata, fill forms, click elements, and extract table data. Scripts run only when the AI assistant invokes a tool and only on the active tab.

### storage
Required to persist user preferences (tool permission toggles, connection state) across browser sessions.

### alarms
Required for the service worker's periodic connection-health watchdog so the side panel can self-heal from a broken bridge state without manual reload.

### debugger
Optional, off by default. Required only for advanced tools that need CDP-level access (e.g., capturing high-fidelity screenshots of full-page heights). Disabled via toggle until needed.

---

## Edge Add-ons Submission Notes

The extension is fully compatible with Microsoft Edge 120+ via Chromium's extension API. No Edge-specific modifications are required.

Submit to: https://partner.microsoft.com/en-us/dashboard/microsoftedge/
- Use the same listing copy, icons, and screenshots as the Chrome Web Store listing
- The same .zip build artifact works for both stores
