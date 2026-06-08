# AgentHub - Development Rules

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
cat "$LOCALAPPDATA/agenthub/server.lock"

# 2. Check what's actually listening
netstat -ano | findstr "7483"

# 3. Verify lock file PID matches running process
tasklist | findstr "<PID_FROM_LOCK_FILE>"

# 4. Test native-host-helper returns correct data
node /tmp/test-helper.js  # (create test script that sends read_lock_file via native messaging protocol)

# 5. Test WebSocket connection (origin-auth; no token param needed for local test)
# Connect to ws://127.0.0.1:<PORT>?browserId=test and verify server_info arrives

# 6. Check registry entries
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.agenthub.native_host_helper"
reg query "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.agenthub.native_host"

# 7. Check native messaging manifests have correct extension ID in allowed_origins
cat "$LOCALAPPDATA/agenthub/com.agenthub.native_host_helper.json"
cat "$LOCALAPPDATA/agenthub/com.agenthub.native_host.json"
```

## Key Architecture Details

- Native host writes `server.lock` on startup with pid, port, and an empty token field
- Extension uses `com.agenthub.native_host_helper` (native messaging) to read the lock file and discover the port
- Extension connects via WebSocket with `?browserId=<instance-id>` query parameter
- **Auth is origin-based**: WS server's `verifyClient` checks the `chrome-extension://<id>/` origin against `extension-ids.json` or `AGENTHUB_ALLOWED_EXTENSION_IDS` env var — connections from unknown extension IDs are rejected with HTTP 401 before the WS handshake. There is no `?token=` parameter check.
- Lock file location: `%LOCALAPPDATA%/agenthub/server.lock`
- Extension IDs are stored in `%LOCALAPPDATA%/agenthub/extension-ids.json` — must be a JSON array of real Chrome extension IDs, NOT placeholder values like `"myext123"`
- Extension ID (dev, Profile 1): `ehchmchlmggdigicfjfmlgcbhdcdcmll`

## Common Pitfalls

- Native messaging host registration requires Chrome restart to take effect
- `allowed_origins` in native messaging manifests must include the actual extension ID, not empty string
- Multiple native host processes can run on different ports — always check the lock file for the current one
- The `.cmd` wrapper is needed on Windows because Chrome native messaging requires an executable, not a `.cjs` file
- `DEFAULT_EXTENSION_ID` in `packages/installer/src/shared/constants.ts` is empty — must be provided via flag during install
- Google Chrome stable (138+) AND Chrome Dev (151+) silently ignore `--load-extension` and `--disable-extensions-except`. Only Playwright's bundled Chromium and Microsoft Edge still accept them reliably. See `docs/test-findings.md` §4 and `docs/session-2026-06-08-mcp-fix-and-public-releases.md` §9.
- Extension ID for unpacked `dist/chrome-mv3` is path-derived (SHA256 of UTF-8 absolute path → first 16 bytes → 'a'..'p' encoding). It varies by machine. Tests that need the ID should derive it from the path, not hardcode.

## Release pipeline (two GitHub repos)

Customer-facing installer downloads go through a SEPARATE public repo:

- **Source repo (this one):** `irmasemma/AIBrowserCopilot` — private, holds all source, tests, internal docs.
- **Release-assets repo:** `irmasemma/agenthub-releases` — public, holds ONLY compiled binaries attached to release tags. No source.

`packages/installer/src/shared/constants.ts` sets `GITHUB_REPO = 'irmasemma/agenthub-releases'`. The installer downloads from `https://github.com/irmasemma/agenthub-releases/releases/latest/download/<asset>` — this URL pattern only works anonymously on public repos.

CI workflow (`.github/workflows/release.yml`) dual-publishes on every `v*` tag:
1. Release in the private source repo (default `GITHUB_TOKEN`, for internal tracking)
2. Release in the public agenthub-releases repo (requires `PAT_RELEASES_PUBLIC` repo secret — a fine-grained PAT with Contents:Write on `irmasemma/agenthub-releases`)

If `PAT_RELEASES_PUBLIC` ever expires, customer downloads break silently (the private release still succeeds; the public one fails). Check with `gh secret list --repo irmasemma/AIBrowserCopilot`.

After every CI release, the new `agenthub-setup` installer must be published to npm separately (`cd packages/installer && npm publish`) — otherwise `npx agenthub-setup@latest` still serves the old version.

## End-to-end install + connect test

`tests/e2e/install-and-connect.spec.ts` exercises the full install → connect → MCP path with the user's real browser profile. Default-on against Edge (because of the Chrome stable block above):

```
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  npx playwright test tests/e2e/install-and-connect.spec.ts
```

`COPILOT_TEST_KILL_CHROME=1` is required (it'll close the user's browser session). Test calls `claude -p` for the chat assertions, so `claude` must be on PATH and logged in. Full details + env-var reference + every gotcha hit while building this: `docs/test-findings.md`.
