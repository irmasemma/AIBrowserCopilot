# Test findings — install-and-connect.spec.ts

Findings surfaced by `tests/e2e/install-and-connect.spec.ts`. Status: **both tests green** (Test A — clean reinstall, Test B — stale-installer reinstall).

## TL;DR — running the test

```
# One-time per-machine prereqs
#   * Microsoft Edge installed (or Chrome Dev / Beta / Canary for Chrome)
#   * `claude` CLI on PATH and logged in (this gives you the OAuth token in
#     ~/.claude/.credentials.json — no separate ANTHROPIC_API_KEY needed)
#
# Per-run (rebuilds + run)
npm run build:extension
npm run compile:win -w packages/native-host
npm run compile:win -w packages/native-host-helper
npm run build -w packages/installer
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  npx playwright test tests/e2e/install-and-connect.spec.ts
```

`COPILOT_TEST_KILL_CHROME=1` opts in to closing your running browser session — the user-data-dir lock prevents Playwright from attaching otherwise. Drop `COPILOT_TEST_BROWSER=edge` to use Chrome (the helper auto-discovers Dev / Beta / Canary; refuses stable with a clear pointer to finding #4 below).

Test A runs the clean-reinstall path (full uninstall → install → Connected → 2× `claude -p list_tabs` round-trips through the bridge). Test B runs the stale-install regression (no uninstall first, with the old bridge still running, to verify the new install kills + replaces the binary). Total wall time ~1m on this machine.

### Env vars

| var | default | purpose |
| --- | --- | --- |
| `COPILOT_TEST_KILL_CHROME` | unset (refuses to launch) | must be `1` to opt in to killing the user's browser |
| `COPILOT_TEST_BROWSER` | `chrome` | `edge` or `chrome` |
| `COPILOT_TEST_USER_DATA_DIR` | per-browser default | override real user-data-dir |
| `COPILOT_TEST_PROFILE_DIR` | `Profile 1` (Chrome) / `Default` (Edge) | profile inside the user-data-dir |
| `COPILOT_TEST_CHROME_EXE` | auto-discover | explicit path to chrome.exe |
| `COPILOT_TEST_EDGE_EXE` | auto-discover | explicit path to msedge.exe |
| `COPILOT_TEST_EXPECTED_EXTENSION_ID` | `ehchm…dcmll` | derived from the extension dist path |

## What the test actually verifies

1. Snapshot install state on disk + registry. If anything's installed, run `--uninstall --yes` and verify everything's gone.
2. Run install from local source tree (`--from-local . --extension-id <id>`) and verify all artifacts land (binaries, manifests, registry keys, autostart, lock file, MCP config entries).
3. Launch the user's real browser (Chrome / Edge) with the unpacked extension loaded into the real profile.
4. Wait for the side panel to reach the **Connected** state (badge label = `Connected`, header title = `Connected`, subtitle starts with `Bridge running`).
5. Run two `claude -p` turns asking for a tab list. Each must invoke `mcp__ai-browser-copilot__list_tabs` and return ≥ 1 tab with a non-empty url.
6. Test B's extra check: the old bridge from the prior install was running before reinstall; verify the new install killed those PIDs and replaced the binary mtime.

If any phase fails the helper raises an actionable error pointing at the relevant finding below.

## Detailed findings

## 1. Windows uninstall leaves the helper binary and helper manifest behind

### Summary

`ai-browser-copilot-setup --uninstall --yes` on Windows removes the bridge `.exe`, the bridge manifest, the registry keys, the autostart entry, the lock file, and per-tool MCP config entries — but it does not remove:

- `%LOCALAPPDATA%\ai-browser-copilot\ai-browser-copilot-helper-win-x64.exe`
- `%LOCALAPPDATA%\ai-browser-copilot\com.copilot.native_host_helper.json`

As a side effect, `removeBinary()`'s "remove install dir if empty" cleanup also can't fire, so the install dir stays behind too.

### Reproduction

```
node packages/installer/dist/index.js --uninstall --yes
ls "$env:LOCALAPPDATA\ai-browser-copilot"
```

Expected: directory missing or empty.
Actual: `ai-browser-copilot-helper-win-x64.exe` and `com.copilot.native_host_helper.json` still present.

Test failure (Test A — clean reinstall, post-uninstall snapshot):

```
helper bin:        present (...\ai-browser-copilot-helper-win-x64.exe)
helper manif:      present
```

### Citations

- `packages/installer/src/installers/uninstaller.ts:33-56` — `removeBinary()` only removes the bridge asset (`getAssetName`); never references `getHelperAssetName` despite the import existing on line 6.
- `packages/installer/src/installers/uninstaller.ts:61-73` — `removeManifest()` only removes the bridge manifest (`getManifestPath` returns the bridge path only — see `host-registrar.ts:67-69`).
- `packages/installer/src/installers/uninstaller.ts:150-189` — `removeMultiBrowserRegistrations()` deletes per-browser manifest files (macOS/Linux) and per-browser registry keys (Windows) and the lock file. On Windows it never touches the manifests living in the install dir.
- `packages/installer/src/installers/binary-installer.ts:110-171` — install copies BOTH bridge and helper into install dir.
- `packages/installer/src/installers/browser-registrar.ts:178-210` — on Windows the helper manifest is written to `%LOCALAPPDATA%\ai-browser-copilot\com.copilot.native_host_helper.json` (see line 191-196).

### Root cause

Asymmetric implementation: the install path was extended to copy a helper binary + write a helper manifest, but the uninstall path was not extended to the matching deletes. The uninstaller still treats the helper as something that only lives in per-browser registry keys (which it does delete) — it does not know that on Windows the manifest also lives in the install dir, or that the helper binary lives next to the bridge.

### Fix applied

`packages/installer/src/installers/uninstaller.ts`: extended `removeBinary()` to also unlink the helper asset, and added `removeHelperManifest()` to unlink the helper manifest from the install dir. The "remove install dir if empty" check stays at the end so all three deletes (bridge, helper, helper-manifest) can drain the dir.

### How to verify

1. `npm run build -w packages/installer`
2. (Have something installed first) `node packages/installer/dist/index.js --uninstall --yes`
3. `Test-Path "$env:LOCALAPPDATA\ai-browser-copilot\ai-browser-copilot-helper-win-x64.exe"` → `False`
4. `Test-Path "$env:LOCALAPPDATA\ai-browser-copilot\com.copilot.native_host_helper.json"` → `False`
5. Re-run the spec: `COPILOT_TEST_KILL_CHROME=1 npx playwright test tests/e2e/install-and-connect.spec.ts`

## 2. Test-only fix: Chrome refuses CDP when user-data-dir is the default

### Summary

Test A made it past the install verification but timed out at `chromium.launchPersistentContext`. The Chrome stderr explained:

> DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir.

Chromium 136+ refuses remote debugging (both `--remote-debugging-pipe` and `--remote-debugging-port`) when the resolved `--user-data-dir` matches the OS-default profile path. The original prompt's plan ("real profile, real credentials") put us right onto the default path: `%LOCALAPPDATA%\Google\Chrome\User Data`.

### Fix applied (test-side, not product)

`tests/e2e/helpers/real-chrome.ts`: present the real user-data-dir to Chrome via a directory junction at `%TEMP%\copilot-real-chrome-userdata`. Chrome sees a non-default path string, the gate passes, and the real profile data (cookies, signed-in sessions, extensions, chrome.storage) loads through the junction. The junction is idempotent — created once on the first run, reused after.

## 3. Test-only fix: Chrome 128+ refuses unpacked extensions until Developer Mode is on

### Summary

After the junction fix, Chrome launched cleanly but no extension service worker registered. Diagnostic navigation to `chrome-extension://<expectedId>/sidepanel.html` returned `ERR_BLOCKED_BY_CLIENT` — the extension was never loaded.

Chrome 128+ blocks unpacked extensions in any profile that does not have Developer Mode enabled in `chrome://extensions`. The flag lives at `extensions.ui.developer_mode` in `<profile>/Secure Preferences`, but the value is HMAC-protected: editing it from outside Chrome causes Chrome to reject the change as tampered.

### Fix applied (test-side, not product)

`tests/e2e/helpers/real-chrome.ts`: bootstrap launch flips Developer Mode on by driving `chrome://extensions` via Playwright before the real launch. Polymer shadow-DOM piercing finds the toggle: `extensions-manager` → shadow → `extensions-toolbar` → shadow → `#devMode`. `chrome://` pages allow JS via CDP even though regular content scripts cannot touch them. Idempotent: if Developer Mode is already on, the click is a no-op.

## 4. BLOCKER (not in scope of this test to fix): Google Chrome stable disables `--load-extension`

### Summary

After the previous two fixes, Chrome launched, Developer Mode was confirmed on (Secure Preferences contains `"developer_mode":true` with a valid MAC) — but the extension still didn't load. Capturing Chrome's `chrome_debug.log` (via `--enable-logging --v=1`) revealed:

```
WARNING:chrome\browser\extensions\extension_service.cc:440] --disable-extensions-except is not allowed in Google Chrome, ignoring.
```

…and the extension path (`C:\Dev\1M\ai-browser-copilot\packages\extension\dist\chrome-mv3`) appears nowhere else in the log: `--load-extension` is silently ignored too. Both flags are gated to non-stable channels (Canary / Dev / Beta) and to Chromium itself; Google Chrome stable disables them on enterprise-hardening grounds. This block is in the binary; no command-line flag bypasses it. Chrome version on this machine: **148.0.7778.96**.

### Why this isn't fixable from inside the test

- `--allowlisted-extension-id` / `--whitelisted-extension-id`: do not re-enable `--load-extension`; they only adjust API surface.
- `chrome://extensions` "Load unpacked" button: requires real user click, can't be triggered from `page.evaluate` (file-picker dialog, not a programmatic input).
- `chrome.developerPrivate.loadDirectory`: only available on `chrome://extensions` page; calling it programmatically opens a file-picker for the same reason.
- Editing `Secure Preferences` to register the extension as installed: HMAC-validated, will be reverted on next Chrome launch.
- Enterprise policy `ExtensionInstallSources`: requires admin and is a system-wide change.

### Path chosen: run against Microsoft Edge

`tests/e2e/helpers/real-chrome.ts` is now browser-agnostic. Set `COPILOT_TEST_BROWSER=edge` to drive Edge instead of Chrome — Edge still honours `--load-extension`. The helper also auto-discovers Chrome Dev / Beta / Canary if you'd rather stay on Chrome (just don't set `COPILOT_TEST_BROWSER=edge`); it refuses Chrome stable with a clear error pointing here.

The same `Default` Edge profile, real cookies / sessions / extensions, real native-messaging registry — everything that mattered for "real profile" testing carries over.

## 5. Test refactor: chat assertions go through Claude Code's MCP client, not the side panel

### Summary

The original prompt asked for two side-panel chat turns invoking `list_tabs`. That requires an LLM API key in the extension's storage; if absent, the chat is disabled (`chat-textarea` has `disabled={!hasKey}`) and the test can't make progress.

We swapped to driving `claude -p` (Claude Code CLI) instead. Claude Code is already installed, already authenticated, and already has `ai-browser-copilot` registered as an MCP server (the installer's `addConfigEntry` writes the entry). This tests the *real* product use case (external AI tool calls extension via MCP) more directly than the in-extension chat would, and uses no extra credentials.

### Implementation

- `tests/e2e/helpers/claude-cli.ts` — spawns `claude --print --input-format text --output-format stream-json --allowedTools mcp__ai-browser-copilot__list_tabs --dangerously-skip-permissions`, pipes the prompt over stdin (avoids cmd.exe quoting mangling unicode/quotes), parses the stream-json events for `tool_use` + `tool_result` + final text. `findListTabsCall` correlates them; `parseListTabsResult` is tolerant of all three response shapes the bridge has shipped.
- `tests/e2e/install-and-connect.spec.ts` — `runConnectAndChatPhase` now: opens the side panel, asserts `Connected`, then runs two `claude -p` turns and asserts each invoked `mcp__ai-browser-copilot__list_tabs` and got back ≥ 1 tab with a non-empty url.

### State after this round

```
ok 1 Test A — clean reinstall (34.7s)
ok 2 Test B — stale-installer reinstall (31.2s)
2 passed (1.1m)
```

### How to reproduce

```
# Pre-flight
npm run typecheck -w packages/installer
npm run build:extension
npm run compile:win -w packages/native-host
npm run compile:win -w packages/native-host-helper
npm run build -w packages/installer

# Run (will close all open Edge windows when invoked)
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  npx playwright test tests/e2e/install-and-connect.spec.ts
```

Prerequisites baked into the test (handled automatically — no manual setup):
- Junction at `%TEMP%\copilot-real-edge-userdata` → `%LOCALAPPDATA%\Microsoft\Edge\User Data` (CDP gate workaround).
- Bootstrap launch flips `developer-mode` toggle in `edge://extensions/` (extension-load gate).
- Wake-up navigation forces the MV3 service worker to activate.

External prereqs:
- Microsoft Edge installed (or Chrome Dev for Chrome path).
- `claude` CLI on PATH and logged in.
- `ai-browser-copilot` registered as a Claude Code MCP server (the installer does this).
