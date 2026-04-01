# Chrome Web Store Listing

## Extension Name
AI Browser CoPilot

## Short Description (132 chars max)
Connect your browser to your AI assistant. Read pages, take screenshots, fill forms, and extract data — all from your AI.

## Detailed Description
AI Browser CoPilot bridges your browser and your AI assistant (Claude, VS Code Copilot, etc.) using the Model Context Protocol (MCP). Your AI can now see and interact with the web pages you're viewing.

**What can your AI do with CoPilot?**

FREE TOOLS:
- Read page content — Ask your AI about anything on the current page
- Take screenshots — Let your AI see what you see
- List open tabs — Your AI can help you navigate across tabs

PRO TOOLS:
- Navigate to URLs — AI moves between pages for multi-step tasks
- Fill forms — AI enters data for you, no more copy-paste
- Click elements — AI interacts with buttons and links
- Extract tables — Get spreadsheet-ready data from any HTML table
- Read metadata — AI quickly understands page context

**Privacy first:**
- All data stays on your machine — nothing is sent to external servers
- Default domain blocking protects banking and email sites
- You control which tools are enabled via toggle switches
- Real-time activity log shows every action your AI takes

**How it works:**
1. Install the extension
2. Run the one-command setup: npx ai-browser-copilot-setup
3. Your AI tool is automatically detected and configured
4. Start asking your AI about what's on your screen

Works with Claude Desktop, Claude Code, VS Code, Cursor, Windsurf, JetBrains IDEs, Zed, and Continue.dev.

**Requirements:**
- Chrome 120+ or Edge 120+
- Node.js 18+ (for setup only)
- One of the supported AI tools installed

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

---

## Edge Add-ons Submission Notes

The extension is fully compatible with Microsoft Edge 120+ via Chromium's extension API. No Edge-specific modifications are required.

Submit to: https://partner.microsoft.com/en-us/dashboard/microsoftedge/
- Use the same listing copy, icons, and screenshots as the Chrome Web Store listing
- The same .zip build artifact works for both stores
