# Developer Quick Start

Get AI Browser CoPilot running in 3 steps.

## Prerequisites

- Node.js 18+
- Chrome browser
- VS Code or Cursor

## Step 1: Build and load the extension

```bash
cd C:\Dev\1M\ai-browser-copilot
npm install
cd packages/native-host && npm run build
cd ../extension && npx wxt build
```

Then load it in Chrome:
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select: `C:\Dev\1M\ai-browser-copilot\packages\extension\dist\chrome-mv3`

## Step 2: Configure VS Code

The file `.vscode/mcp.json` is already in the project with this content:

```json
{
  "mcpServers": {
    "ai-browser-copilot": {
      "command": "node",
      "args": ["C:/Dev/1M/ai-browser-copilot/packages/native-host/dist/index.js"]
    }
  }
}
```

Restart VS Code to load the MCP server.

## Step 3: Test it

1. Open any webpage in Chrome (e.g., https://example.com)
2. In VS Code, ask your AI: "Read my browser tab"
3. The AI should use the `get_page_content` tool and return the page content
4. Check the extension popup — it should show "Connected"

That's it. The extension auto-connects to the MCP server on port 7483.

## How it works

```
You ask AI a question
    ↓
VS Code starts MCP server (node dist/index.js)
    ↓
MCP server opens WebSocket on localhost:7483
    ↓
Chrome extension auto-connects to port 7483
    ↓
AI invokes a tool → MCP server → WebSocket → extension → content script → page
    ↓
Result flows back to AI
```

## Troubleshooting

**Extension shows "Setup Required":**
The MCP server isn't running yet. Ask your AI something in VS Code — it will start the server automatically via the MCP config.

**Extension shows "Reconnecting...":**
The MCP server stopped. It starts on-demand when your AI needs it.

**VS Code doesn't see the MCP server:**
Check `.vscode/mcp.json` has the correct path and restart VS Code.
