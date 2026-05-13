Here's a single comprehensive prompt covering both tests. Paste it into a fresh Claude session in the project directory.

---

````
We're working in C:\Dev\1M\pilotwave — a multi-package monorepo for the Pilotwave Chrome extension. Project context lives in CLAUDE.md and docs/. Read both before starting.

# Goal

Write a real end-to-end Playwright test suite that drives the user's real Chrome (real profile, real credentials — not an ephemeral Playwright profile) through two install/upgrade scenarios. The suite must run against the local working tree and pass on a clean machine and on a "stale leftover" machine.

Output one new spec file at: tests/e2e/install-and-connect.spec.ts. Add helpers under tests/e2e/helpers/ as needed. Reuse what's already there — do NOT duplicate logic that lives in scripts/launch-edge-debug.mjs or tests/e2e/connection-e2e.spec.ts unless the existing version is wrong for this scenario; if so, factor it out.

# The two test cases

## Test A — "Clean reinstall"

1. Detect whether Pilotwave is currently installed on this machine (extension AND native host).
2. If anything is installed, uninstall **completely**: extension + native-host bridge + helper + native-messaging manifests + Windows registry keys + autostart entry + lock file + MCP config entries from every detected AI tool. Use `npx pilotwave-setup --uninstall --yes` (or `node packages/installer/dist/cli.js --uninstall --yes` if running from the local tree). After uninstall, none of the artifacts in §"State to verify" below should exist.
3. Install from the local working tree: `node <local-installer-cli> --from-local . --extension-id ehchmchlmggdigicfjfmlgcbhdcdcmll --yes`. The installer auto-discovers binaries under packages/native-host/bin/ and packages/native-host-helper/bin/. Make sure those exist first — if not, build them: `npm run compile:win -w packages/native-host && npm run compile:win -w packages/native-host-helper`.
4. Build the extension: `npm run build:extension` (output lands at packages/extension/dist/chrome-mv3/).
5. Launch the user's real Chrome with `--load-extension=<that path>` and the user's user-data-dir (see §"Real Chrome launch"). Open the side panel.
6. Assert the side panel shows the **Connected** state (status badge text "Connected", header title "Connected"). It must NOT show "Setup incomplete", "Bridge isn't running", or "Bridge running but unresponsive".
7. Open two NEW chats in the side panel (the chat-first UI). In each chat send a message that asks the model to list the open tabs (e.g. "list my open tabs"). Assert that BOTH chats successfully invoke the `list_tabs` tool and return a JSON array containing at least one tab whose `url` field is non-empty.

## Test B — "Stale-installer reinstall"

Same as Test A, except step 2 uninstalls **only the extension**, leaving the native-host bridge, helper, registry keys, manifests, autostart entry, lock file, and tool config entries on disk (i.e. simulate a user who removed the extension but never ran `--uninstall`). Specifically: do NOT call the installer's uninstall flow; instead, just remove the extension by closing Chrome and deleting/skipping --load-extension on the next launch (and clearing the unpacked path if it was previously cached anywhere). The native-host artifacts should be the OLD ones from a prior install.

Then perform steps 3–7 from Test A. The reinstall must overwrite the stale binaries, refresh the manifests/registry, and the side panel must reach **Connected** with both chats successfully calling `list_tabs`. This is the regression test for the multi-instance image-name kill fix — there will be a running bridge from the old install that must be killed before the new binary can be renamed in.

# Concrete details (use these exact strings/paths)

## Side-panel status text — exact strings the test must read

Source files:
- packages/extension/src/sidepanel/components/status-badge.tsx (~lines 17–34)
- packages/extension/src/sidepanel/components/connection-header.tsx (~lines 43–179)

Status badge texts: "Not Connected", "Connecting...", "Connected", "Unstable", "Reconnecting...", "Checking connection..."

Header titles you may encounter: "Connected", "Verifying connection…", "Connection unstable", "Bridge is outdated", "Bridge isn't running", "Setup incomplete", "Bridge running but unresponsive", "Lost connection", "Reconnecting (attempt N)…", "Bridge looks broken", "Looking for bridge…", "Not connected"

Pass criterion: badge="Connected" AND header title="Connected" AND header subtitle starts with "Bridge running".

## Installer CLI

Defined in packages/installer/src/index.tsx (argparse around lines 21–55).

Flags: `--yes`, `--tools <csv>`, `--update`, `--uninstall`, `--extension-id <id>`, `--from-local <path>`.

Local invocation: build the installer first (`npm run build -w packages/installer`), then call `node packages/installer/dist/cli.js …`. Or use `npx pilotwave-setup …` if you want to test the published path — but for these tests, the **local** path is what we want, because we're verifying the working-tree code.

Uninstall flow lives in packages/installer/src/installers/uninstaller.ts (lines 195–243). It removes:
- Bridge + helper binaries from %LOCALAPPDATA%\pilotwave\
- Native-messaging manifests com.pilotwave.native_host.json and com.pilotwave.native_host_helper.json from the same dir
- Lock file server.lock from the same dir
- Registry keys under HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.pilotwave.native_host and …\com.pilotwave.native_host_helper (and equivalent for Edge, Brave, Arc, Vivaldi if detected)
- Autostart key HKCU\Software\Microsoft\Windows\CurrentVersion\Run\AIBrowserCopilot
- MCP config entries from every detected AI tool (Claude Desktop, Claude Code, VS Code, Cursor, etc.)

## State to verify on this Windows machine

Install dir: `%LOCALAPPDATA%\pilotwave\` (resolved by packages/installer/src/shared/platform.ts line ~56).

Files inside (when installed):
- pilotwave-win-x64.exe (bridge)
- pilotwave-helper-win-x64.exe (helper)
- com.pilotwave.native_host.json (manifest)
- com.pilotwave.native_host_helper.json (manifest)
- server.lock (JSON: { port, token, pid, startedBy })

Registry (HKCU):
- SOFTWARE\Google\Chrome\NativeMessagingHosts\com.pilotwave.native_host → manifest path
- SOFTWARE\Google\Chrome\NativeMessagingHosts\com.pilotwave.native_host_helper → manifest path
- Software\Microsoft\Windows\CurrentVersion\Run\AIBrowserCopilot → "<install-dir>\pilotwave-win-x64.exe" --service

Use `reg query` and `Test-Path` (or `fs.existsSync`) to verify presence/absence between phases.

## list_tabs response shape

Tool defined in packages/native-host/src/tools/list-tabs.ts. Dispatch in packages/extension/src/background/tool-dispatcher.ts (~lines 364–388). Success returns:

```
{ "content": [ { "type": "text", "text": "<JSON-stringified array of tab objects>" } ] }
```

Each tab object: `{ id: string (composed as "<browserId>:<rawTabId>"), title: string, url: string, active: boolean, pinned: boolean }`.

Test assertion: parse `content[0].text` as JSON, expect array length ≥ 1, expect at least one entry with non-empty `url`.

## Real Chrome launch

The default Playwright pattern (`chromium.launchPersistentContext('', …)`) uses an EPHEMERAL profile — that is NOT what we want here. The user wants their REAL profile so signed-in sessions and real tabs are present.

Real user-data-dir path on Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`. Profile name: usually `Default`, but for this dev machine it's `Profile 1` (the dev extension ID `ehchmchlmggdigicfjfmlgcbhdcdcmll` corresponds to Profile 1 — see CLAUDE.md).

Pattern to use:
- Resolve user-data-dir from `process.env.LOCALAPPDATA + '\\Google\\Chrome\\User Data'`. Allow override via env var `COPILOT_TEST_USER_DATA_DIR` and `COPILOT_TEST_PROFILE_DIR` (default "Profile 1").
- BEFORE launching: kill any running `chrome.exe` processes — Chrome holds an exclusive lock on the user-data-dir, so a running Chrome will prevent the test from attaching. Use `taskkill /IM chrome.exe /F` on Windows; warn the user if the test starts while Chrome is open. Skip the test (don't fail it) if `process.env.COPILOT_TEST_KILL_CHROME !== '1'` to avoid trampling the user's session unintentionally — make this an explicit opt-in.
- Launch via `chromium.launchPersistentContext(userDataDir, { args: [`--profile-directory=${profile}`, `--load-extension=${extDist}`, `--disable-extensions-except=${extDist}`, '--no-first-run'] })`.
- Discover the loaded extension's ID from `context.serviceWorkers()` — wait up to 5s for the service worker to register. Confirm it equals `ehchmchlmggdigicfjfmlgcbhdcdcmll`; if not, print both expected and actual and fail with a clear message (the extension ID is per-profile and per-key).

scripts/launch-edge-debug.mjs has prior art for resolving real-browser user-data-dir paths — read it for patterns.

## Driving the side panel

The side panel is at `chrome-extension://<extId>/sidepanel.html`. Open a new Page in the persistent context pointing at that URL. Read the status-badge text via `page.locator('[data-testid="status-badge"]')` if a testid exists; otherwise scope by accessible role/text. Open the badge component file before guessing — use whatever locator the existing component renders.

Opening "two new chats" — find the new-chat affordance in the side panel's chat UI (look under packages/extension/src/sidepanel/ for components named like `chat-list`, `chat-tabs`, or similar). Send a user message and wait for the assistant turn to complete by polling for the `list_tabs` tool-call result rendered in the chat. If the chat UI lacks stable testids, ADD them (it's an internal change to the test surface — not a behavior change) and use them.

# How to run the tests

```
npm run typecheck -w packages/installer
npm run build:extension
npm run compile:win -w packages/native-host
npm run compile:win -w packages/native-host-helper
COPILOT_TEST_KILL_CHROME=1 npx playwright test tests/e2e/install-and-connect.spec.ts
```

# Behavior loop — REQUIRED

Run the test. If it fails:

1. Read the failure carefully. Is the failure in the test (wrong selector, wrong path, race condition) or in the product (installer leaves something behind, side panel never reaches Connected, list_tabs returns empty)?
2. If the failure is in the test: fix the test, re-run. Loop.
3. If the failure looks like a product bug:
   - Inspect the relevant files to confirm. Use the install-dir paths, registry keys, and lock-file format above to gather evidence.
   - Document the bug: append to a new file `docs/test-findings.md` (create if missing) with — bug summary, reproduction steps, file:line citations, root cause, proposed fix.
   - Apply the fix to the product code.
   - Re-run the test.
   - **DO NOT git commit. DO NOT git push. DO NOT create a PR.** Leave the working tree dirty for the user to review. Do not stage files. If you need to share a diff, paste it inline in your final response.
4. Loop until both tests pass, or until you can clearly explain what's blocking and what you'd need from the user to unblock.

# What "done" looks like

- tests/e2e/install-and-connect.spec.ts exists with both test cases.
- Running `COPILOT_TEST_KILL_CHROME=1 npx playwright test tests/e2e/install-and-connect.spec.ts` exits 0 with both tests green.
- Any product bugs found are documented in docs/test-findings.md with fixes applied to the working tree but uncommitted.
- Final response summarises: which tests pass, what you fixed (test code vs product code), file:line for any product changes, and how to reproduce manually.

# Constraints / things to avoid

- No mocks. No stubbing of native messaging, the bridge, or the WebSocket. Real binaries, real Chrome, real WebSocket, real tool dispatch.
- No tests against npm-published `pilotwave-setup` (it's stale at 0.1.2). Always use the local installer build.
- Don't add new dependencies unless you can justify why an existing one (playwright, node:child_process, node:fs, node:net) won't do.
- Don't commit. Don't push. Don't tag. Don't open PRs.
- If the user's real Chrome profile is the only Chrome process running on this machine, killing it interrupts their work — the COPILOT_TEST_KILL_CHROME env-gate exists so the test refuses to run without explicit opt-in. Keep that gate.
- Don't write multi-paragraph comments or docstrings in the test file. Tight, named helpers; let the code read.
````

---

A few things I deliberately put in:

- **`COPILOT_TEST_KILL_CHROME=1` opt-in** — running these against your real profile while you're using Chrome will close it. The env-gate keeps an LLM agent from trampling your session unprompted.
- **Test B is the regression test for the bug we just fixed** — stale bridge from old install must be killed by image-name. If you re-run after a release that includes `a6c678c`, Test B should pass; before that, it should fail at install with EPERM and the LLM should find/document the same bug.
- **`docs/test-findings.md`** — concrete dumping ground for product bugs the test surfaces, since you said "document, fix, never commit."
- **`Profile 1`** — pulled from CLAUDE.md (the dev extension ID is bound to that profile). Override env vars are there if you use a different profile.

If you'd rather have **two separate prompts** (one per test), say the word and I'll split them.