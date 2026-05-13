# End-to-end tests for the extension

Two Playwright specs at the repo root drive the real installer + real browser + real bridge end-to-end. They live outside this package (under `tests/e2e/`) because they exercise the whole product — installer, native host, helper, extension — together. Documented here because the extension is the moving part most likely to break them.

Both specs are opt-in. They will kill any running browser session: gate is `COPILOT_TEST_KILL_CHROME=1`.

## `tests/e2e/install-and-connect.spec.ts`

**Two tests**, serial, against the real browser.

| Test | What it covers |
| --- | --- |
| Test A — clean reinstall | Snapshot install state → full `--uninstall --yes` if anything's there → verify everything's gone → install from local working tree → verify all artifacts land → launch real browser with extension → side panel reaches **Connected** → two `claude -p` turns each invoke `mcp__ai-browser-copilot__list_tabs` and return ≥ 1 tab with a non-empty url. |
| Test B — stale-installer reinstall | Same install state seeding, but **without** running `--uninstall` first. The old bridge from the prior install is still running. New install must kill those PIDs and overwrite the binary. Side panel reaches **Connected**; same two `claude -p` list_tabs round-trips. This is the regression test for the multi-instance image-name kill fix. |

Chat assertions go through Anthropic's `claude` CLI (Claude Code) — `ai-browser-copilot` is registered as an MCP server during install, so `claude -p` invokes the bridge over MCP for the `list_tabs` tool. Uses the user's existing Claude Code login (`~/.claude/.credentials.json`); no extra API key needed.

### Run

```
npm run build:extension
npm run compile:win -w packages/native-host
npm run compile:win -w packages/native-host-helper
npm run build -w packages/installer
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  npx playwright test tests/e2e/install-and-connect.spec.ts
```

Default browser is Chrome — but Google Chrome stable (138+) silently ignores `--load-extension`, so the helper refuses stable with a pointer to install Chrome Dev / Beta / Canary, or to use Edge. The simplest path on Windows is `COPILOT_TEST_BROWSER=edge`.

### Prereqs picked up automatically (no manual setup)

- Junction at `%TEMP%\copilot-real-edge-userdata` → real Edge user-data-dir (works around the Chrome/Edge "no remote debugging on default profile" gate).
- Bootstrap launch flips the `developer-mode` toggle in `edge://extensions/` (works around the Chrome 128+ unpacked-extension block).
- Wake-up navigation forces the lazy MV3 service worker to activate before SW discovery.

### External prereqs

- Microsoft Edge installed (or Chrome Dev for the Chrome path).
- `claude` CLI on PATH and logged in.

## `tests/e2e/install-and-chat.spec.ts`

**Three tests (Test C, D, E)**, serial, exercising the **in-extension side-panel chatbot** (not Claude CLI) end-to-end against each LLM provider whose key is in env. C and D verify the chat works with and without the bridge; E verifies the side panel self-heals from broken to Connected after an install with no manual reload.

| Test | What it covers |
| --- | --- |
| Test C — side-panel chat, bridge connected | Same install + launch + Connected path as Test A. Then for each provider whose key is set: seed the provider config into `chrome.storage`, reload the side panel, open a new chat, send `LIST_TABS_PROMPT`, wait for the chat to render a successful `list_tabs` tool-call bubble, and independently dispatch `list_tabs` to verify the bridge returns real tabs. |
| Test D — side-panel chat, bridge NOT installed | Uninstall everything first (no bridge, no helper, no MCP registration). Launch browser. Bypass the SetupWizard via `chrome.storage.local.set({ setupComplete: true })` so the chat tab is rendered. Send `LIST_TABS_PROMPT` to each provider's chat. Asserts that `list_tabs` round-trips end-to-end even with no bridge — confirms it's a pure `chrome.tabs.query` call dispatched via background `dispatch_tool`, no MCP server involved. |
| Test E — side panel self-heals from no-bridge to Connected | Start from the same no-bridge state as Test D. Open the side panel, assert it does NOT show "Connected". Run the installer *while the panel is open*. Wait up to 3 min (generous; in practice ~10s) for the header title to transition to "Connected" without any manual click or extension reload. Verifies the SW alarm + fast-poll watchdog actually recover automatically. |

Tests skip themselves with a clear message when no key env vars are set. Configured providers and their env vars:

| Provider | Env var | Model used | Stored key id in `chrome.storage.local` |
| --- | --- | --- | --- |
| OpenAI | `COPILOT_TEST_OPENAI_KEY` | `gpt-4.1-mini` | `openaiApiKey` |
| Anthropic | `COPILOT_TEST_ANTHROPIC_KEY` | `claude-haiku-4-5` | `anthropicApiKey` |

Keys are read from env at runtime; never written into any file in the repo.

### Run

```
COPILOT_TEST_KILL_CHROME=1 COPILOT_TEST_BROWSER=edge \
  COPILOT_TEST_OPENAI_KEY=sk-proj-... \
  COPILOT_TEST_ANTHROPIC_KEY=sk-ant-api03-... \
  npx playwright test tests/e2e/install-and-chat.spec.ts
```

If a key is invalid, the diagnostic dumps the chat transcript, the count of error-ish text matches, recent page-error events, and the last 30 console lines — usually surfaces `401 invalid x-api-key` directly.

### Why Test E exists

When the user runs the test suite (which uninstalls everything) and then manually runs `npx ai-browser-copilot-setup --update`, the side panel sometimes got stuck in contradictory states like "Setup incomplete" + "Helper available / Helper returned no data". Root cause traced to four issues in the extension's recovery flow; all fixed (see `docs/test-findings.md` §6). Test E is the regression that proves the recovery loop now works.

## Shared helpers (under `tests/e2e/helpers/`)

| File | Purpose |
| --- | --- |
| `real-chrome.ts` | Browser-agnostic launch (Chrome / Edge), junction workaround for the CDP gate, Developer-Mode bootstrap, SW discovery + wake-up |
| `install-state.ts` | Snapshot install state on disk + registry; `isFullyInstalled` / `isFullyUninstalled` predicates |
| `installer-cli.ts` | Wraps the local installer build (`packages/installer/dist/index.js`) — never calls the published `npx ai-browser-copilot-setup` |
| `sidepanel.ts` | Drives the side-panel UI — chat tabs, status badge, `chrome.runtime.sendMessage` dispatch helpers, etc. |
| `claude-cli.ts` | Spawns `claude --print --output-format stream-json`, parses tool_use + tool_result events, exposes `findListTabsCall` / `parseListTabsResult` |

## Background reading

`docs/test-findings.md` at the repo root has the full root-cause analysis for every blocker hit while building this — including:
1. Real product bug: Windows uninstall leaving helper binary + helper manifest behind (fixed in `packages/installer/src/installers/uninstaller.ts`).
2. Chrome/Edge "no CDP on default user-data-dir" gate → junction workaround.
3. Chrome/Edge 128+ unpacked-extension block → Developer-Mode bootstrap via Polymer shadow-DOM piercing.
4. Google Chrome stable disabling `--load-extension` → reason we default to Edge.
5. Why chat assertions in `install-and-connect` use `claude -p` rather than the side-panel chatbot.
6. **Four product fixes to the extension's recovery flow** — `fetchServiceStatus` shape-skew handling, `setDiagnostic` actionable-reason preservation, `Reload extension` button on every error state, and a 5s fast-poll watchdog while broken.
