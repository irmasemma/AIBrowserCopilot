# AI Browser CoPilot - Development Rules

## Project Structure

Monorepo with 4 packages:
- `packages/extension` — Chrome extension (Manifest V3, WXT, Preact)
- `packages/native-host` — WebSocket relay server (Node.js, MCP SDK)
- `packages/native-host-helper` — Native messaging helper for service discovery (reads lock file)
- `packages/installer` — Setup assistant UI (Ink/React CLI)

## Build & Test Commands

**CRITICAL: Always rebuild compiled binaries, not just TypeScript source. The MCP config and real users run the compiled .exe, not the dev version. Never point configs to dev/source as a shortcut.**

**CRITICAL: When pushing code that changes the native host, ALWAYS publish a new GitHub release with the recompiled binary.** The installer downloads from GitHub releases — if the release is stale, every customer gets the old broken binary. Run `gh release create` after compiling. This is not optional.

```bash
# Full clean build (from project root)
npm run build --workspaces

# Individual packages
cd packages/extension && npm run build
cd packages/native-host && npm run build && npm run compile:win   # ALWAYS recompile the binary
cd packages/native-host-helper && npm run bundle
cd packages/installer && npm run build

# Run all tests
npm test --workspaces

# Run tests for a specific package
cd packages/extension && npm test
cd packages/native-host && npm test

# Run e2e tests
npx playwright test
```

## Verification Before Declaring Done

**CRITICAL: Never tell the user "it should work" or "restart and try". Always verify yourself first.**

Before asking the user to test anything, you MUST:

1. **Clean build** — rebuild any changed package from scratch (`npm run build` or `npm run bundle`), never rely on cached/stale builds
2. **Run unit tests** — `npm test` in affected packages, all must pass
3. **End-to-end verification** — test the actual runtime chain, not just code review:
   - If touching connection/discovery: test the native messaging helper responds correctly, test WebSocket connects with token, verify `server_info` is received
   - If touching tools: test the tool executes and returns expected output
   - If touching UI: verify the built extension loads without errors
4. **Verify file state** — check that built artifacts, manifests, and registry entries are correct and current (not stale)
5. **Check for stale processes** — look for orphaned processes on expected ports that could interfere

### Connection Chain Verification Script

When debugging connection issues, always run this full chain check:

```bash
# 1. Check lock file
cat "$LOCALAPPDATA/ai-browser-copilot/server.lock"

# 2. Check what's actually listening
netstat -ano | findstr "7483"

# 3. Verify lock file PID matches running process
tasklist | findstr "<PID_FROM_LOCK_FILE>"

# 4. Test native-host-helper returns correct data
node /tmp/test-helper.js  # (create test script that sends read_lock_file via native messaging protocol)

# 5. Test WebSocket connection with token
# Connect to ws://127.0.0.1:<PORT>?token=<TOKEN> and verify server_info arrives

# 6. Check registry entries
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.copilot.native_host_helper"
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.copilot.native_host"

# 7. Check native messaging manifests have correct extension ID in allowed_origins
cat "$LOCALAPPDATA/ai-browser-copilot/com.copilot.native_host_helper.json"
cat "$LOCALAPPDATA/ai-browser-copilot/com.copilot.native_host.json"
```

## Key Architecture Details

- Native host generates a random auth **token** on startup, writes it to `server.lock`
- Extension uses `com.copilot.native_host_helper` (native messaging) to read the lock file and discover port + token
- Extension connects via WebSocket with `?token=xxx` query parameter
- Without the token, connections are rejected with code 4001 before `server_info` is sent
- Lock file location: `%LOCALAPPDATA%/ai-browser-copilot/server.lock`
- Extension ID (dev, Profile 1): `ehchmchlmggdigicfjfmlgcbhdcdcmll`

## Common Pitfalls

- Native messaging host registration requires Chrome restart to take effect
- `allowed_origins` in native messaging manifests must include the actual extension ID, not empty string
- Multiple native host processes can run on different ports — always check the lock file for the current one
- The `.cmd` wrapper is needed on Windows because Chrome native messaging requires an executable, not a `.cjs` file
- `DEFAULT_EXTENSION_ID` in `packages/installer/src/shared/constants.ts` is empty — must be provided via flag during install
