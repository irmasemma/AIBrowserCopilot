---
name: Natural MCP Tool Usage
description: MCP tool descriptions must be written for natural language triggers, not just technical accuracy. Users won't say "use get_page_content" — they say "what's on my tab?"
type: feedback
---

MCP tool descriptions should include natural language triggers like "Use this when the user asks about what is on their screen" — not just technical descriptions like "Extract text content from active tab."

**Why:** User tested the extension with Claude Code and Claude didn't invoke the tools from natural prompts. The descriptions were technically correct but didn't match how users actually speak.

**How to apply:** When writing MCP tool descriptions, always include a "Use this when..." clause with common natural language phrases users would say. Test by asking Claude naturally before shipping.
