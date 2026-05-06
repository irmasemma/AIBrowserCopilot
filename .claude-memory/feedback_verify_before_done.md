---
name: Verify before marking done
description: Always rebuild ALL artifacts, publish GitHub release with fixed binary, never rely on stale builds
type: feedback
---

Never tell the user "it should work" or "restart and try". Always verify the full chain yourself first with fresh builds and real runtime checks.

**Why:** User got burned repeatedly by stale compiled binaries. The installer downloads from GitHub releases — if we fix bugs locally but don't publish a release, the installer overwrites the fixed binary with the old broken one. This happened during the 2026-03-31 session and reverted every fix.

**How to apply:**
1. **ALWAYS rebuild the production artifact** — `npm run compile:win` for the native host binary. NEVER just rebuild TS source. NEVER point configs to dev/source versions.
2. **ALWAYS deploy compiled artifacts to install locations.** The running native host uses the binary at `%LOCALAPPDATA%/ai-browser-copilot/ai-browser-copilot-win-x64.exe`, NOT the one in `packages/native-host/bin/`. After recompiling:
   - Kill the running native host process (check `netstat -ano | grep 7483` for PID)
   - Copy the new binary: `cp packages/native-host/bin/ai-browser-copilot-win-x64.exe "$LOCALAPPDATA/ai-browser-copilot/"`
   - Restart the native host from the install location
   - This applies to ALL compiled outputs (exe, dll, etc.) — always check where the runtime reads from and deploy there.
3. **ALWAYS publish a GitHub release when pushing code that changes the native host binary.** The installer downloads from `https://github.com/irmasemma/AIBrowserCopilot/releases/latest/download/`. If the release binary is stale, every customer who runs the installer gets the old broken version. Use `gh release create` to publish after compiling.
4. Run unit tests — all must pass
5. End-to-end runtime verification — test the ACTUAL binary/artifact that users and MCP configs point to, not the dev version
6. Check for stale state — orphaned processes, old lock files, wrong ports
7. Kill stale processes before starting fresh ones
8. Only THEN tell the user it's ready
