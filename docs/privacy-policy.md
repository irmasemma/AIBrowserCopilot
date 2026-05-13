# Privacy Policy — Pilotwave

**Effective:** 2026-05-12
**Last updated:** 2026-05-12

Pilotwave is a Chrome extension that connects your browser to AI assistants (an in-extension chat agent, or external AI tools via the Model Context Protocol). This policy explains what data Pilotwave handles and what it does not.

## TL;DR

- Pilotwave does **not** operate a server that receives your browsing data. Page content, screenshots, and form data go from your browser **directly** to the AI provider you choose (OpenAI for chat; your local AI tool for MCP).
- Pilotwave does **not** sell, transfer, or share your data with third parties for advertising, profiling, or any purpose unrelated to performing the AI action you invoked.
- All settings, your OpenAI API key, and activity logs are stored **locally** in your browser's extension storage.

## 1. Data Pilotwave processes

When you invoke an AI action (via the chat sidebar or an MCP-connected tool), Pilotwave reads data from the **active tab** to fulfill that action:

- Page content (text, HTML, structured data)
- Page metadata (title, URL of the active tab)
- Screenshots (when you or the AI explicitly takes one)
- Form field contents (when the AI is asked to read or fill a form)
- Open-tab list (when the AI is asked to list or switch tabs)

This data is **only collected at the moment you invoke an action**, and is sent only to the AI provider you've configured.

## 2. Where your data goes

### Chat sidebar (Phase 1, user-supplied API key)
- Chat messages and the tool-result snippets the AI needs to answer are sent to **`api.openai.com`** over HTTPS, using **your own OpenAI API key**, which you paste into Settings and which is stored only in your browser's local extension storage. Pilotwave's developer never sees this key or the data it transmits.
- See [OpenAI's privacy policy](https://openai.com/policies/privacy-policy/) for how OpenAI handles requests.

### MCP server (external AI clients)
- When you connect an MCP-capable AI tool (Claude Code, Cursor, VS Code, Windsurf, Continue, JetBrains, Zed, etc.), tool calls flow **locally** between that tool and Pilotwave's local native-messaging host over localhost — no internet hop.
- Page data returned to your AI tool is then transmitted by that AI tool to its own provider (e.g., Anthropic for Claude Code, your configured model provider for Cursor) according to **that tool's** privacy policy.

## 3. Data stored on your device

The following are stored in Chrome's local extension storage (`chrome.storage.local`) — never transmitted off-device by Pilotwave:

- Your OpenAI API key (for chat)
- Per-tool permission toggles
- Domain blocklist (sites where the AI is not allowed to act)
- Connection state for the MCP transport
- Real-time activity log of AI actions

You can clear all of this at any time by removing the extension or using your browser's site/storage controls.

## 4. Permissions and why we ask for them

- **tabs** — list/switch/target tabs when your AI requests it
- **sidePanel** — render the chat, tools, and settings UI
- **nativeMessaging** — talk to the local MCP server binary
- **scripting** — run content scripts on the active tab during AI-invoked actions
- **storage** — persist preferences and API key locally
- **debugger** — Playwright-based form filling (iframes, ARIA widgets, contenteditable, file upload, date pickers)
- **alarms** — periodic heartbeat for the MCP connection
- **`<all_urls>` (optional)** — granted only if you opt in via Settings; lets the AI act on any site you visit. Default is per-site (you grant each site individually).

## 5. What Pilotwave never does

- ❌ Never sells your data to third parties.
- ❌ Never uses your data to train AI models.
- ❌ Never transmits page content to Pilotwave-operated servers (we don't operate any).
- ❌ Never reads passwords, payment information, or authentication tokens.
- ❌ Never operates on a site that's in the default blocklist (banking, email) unless you explicitly remove that site from the blocklist.

## 6. Children's privacy

Pilotwave is not directed at children under 13. We do not knowingly collect data from children.

## 7. Changes to this policy

Material changes will be reflected by updating the "Last updated" date above and (where appropriate) notified inside the extension before they take effect.

## 8. Contact

Questions about privacy: use **"Report a Problem"** inside the extension, or email the developer contact listed on the Chrome Web Store listing page.

---

_Pilotwave is an independent product. "Claude" is a trademark of Anthropic, PBC. "Cursor" is a trademark of Anysphere Inc. "ChatGPT" and "GPT" are trademarks of OpenAI, OpCo, LLC. "VS Code" is a trademark of Microsoft Corporation. These names are used here descriptively, not to imply affiliation._
