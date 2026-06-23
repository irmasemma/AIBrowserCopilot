---
name: When investigating, check — don't infer
description: User wants verified facts about disk/system state, not architecturally-plausible guesses.
type: feedback
originSessionId: 4b9bf318-ef3a-4d9f-b709-dff4f9d20c43
---
When the user asks "is X registered?" / "where is Y configured?" / "do you see Z?" — they mean **actually inspect the file system / registry / running process**, not infer from the codebase or recall from memory.

**Why:** explicitly corrected on 2026-04-30 with "Do not guess, check if you see my copiloti mcp?" Earlier in the same session I had given a confident architectural answer based on code reading; turned out the actual on-disk state was different (CoPilot WAS registered for VS Code via `.vscode/mcp.json` — I'd missed that file because I was reasoning about Claude Code's config locations from the codebase). Real verification surfaced the truth in one PowerShell command.

**How to apply:**
- For any "is it set up?" / "does X exist?" question, run an actual check: `Test-Path`, `Get-Content`, `reg query`, `claude mcp list`, etc. — before claiming a state.
- Don't enumerate likely paths and stop when one is missing. Enumerate systematically across all standard config locations and report the full picture.
- When you DO infer from code, mark it as inference: "based on the code, I'd expect X" — and offer to verify.
- "Investigate, don't fix" requests are common from this user. Treat them literally — produce a diagnosis backed by checks, no proposed code changes unless asked.
