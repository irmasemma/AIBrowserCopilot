# Production readiness — AgentHub extension v0.5.19 (Chrome Web Store release)

Branch: `multi-client-architecture`. This document covers the CWS-only release
package (`packages/extension`). It does not cover the native-host/bridge
release process (`compile:win` + `gh release create`), which is unchanged and
out of scope for this submission.

## 1. What's in this release

Four minimal, UI-only changes to the side panel (`packages/extension/src/sidepanel`,
`packages/extension/src/entrypoints/sidepanel/main.tsx`). No chat logic,
provider-key logic, storage, or connection/bridge behavior was changed,
refactored, or deleted — only what renders in the tab strip and two default UI
states.

| # | Change | File(s) | How it's hidden |
|---|--------|---------|------------------|
| 1 | Chat tab removed from the tab strip | `entrypoints/sidepanel/main.tsx` | `{ id: 'chat', label: 'Chat' }` entry commented out of the `tabs` array in `TabStrip`. `ChatTab` component and `chat-engine.ts` are untouched and still mounted (just unreachable via the nav); `activeTab` can no longer become `'chat'` because nothing sets it. |
| 2 | AI Provider Keys section hidden | `sidepanel/components/settings-tab.tsx` | Section wrapped in `{SHOW_PROVIDER_KEYS && (...)}` with `const SHOW_PROVIDER_KEYS = false`. `ApiKeySection`, `PROVIDER_META`, `PROVIDER_ORDER`, and `chrome.storage.local` read/write logic are untouched. |
| 3 | MCP tab is first and default | `entrypoints/sidepanel/main.tsx` | `tabs` array reordered to `[mcp, tools, settings]`; `useState<TabId>('mcp')` replaces the old `useState<TabId>('chat')` default. |
| 4 | Connection diagnostics panel expanded by default | `sidepanel/components/connection-header.tsx` | `useState(false)` → `useState(true)` for the `showDiag` flag that gates `<DiagnosticsPanel>`. The collapse toggle button is untouched — users can still collapse it. |

**Why chat is hidden:** a serious bug was found in the chat tab shortly before
this release. Rather than rush a fix under release pressure, the tab is hidden
from the UI for this release; the code remains in the tree unmodified so the
bug can be diagnosed and fixed on its own timeline, then re-enabled by
reverting change #1 (see Rollback below).

## 2. Verification done

- **Unit tests:** `cd packages/extension && npm test` → 25 test files, 357
  tests, all passing (run twice, after both rounds of changes). Three tests in
  `entrypoints/sidepanel/main.test.tsx` were updated to match the new default
  tab (`'mcp'` instead of `'chat'`) and the fact that the MCP panel is now
  active-not-hidden on first render — no test assertions were weakened or
  deleted, only the literal expected tab/hidden-state was corrected to match
  the new intended default.
- **Build:** `cd packages/extension && npm run build` (wxt/Vite production
  build) → clean, no errors, run three times across the three rounds of
  changes.
- **Built-output verification (not just "build succeeded"):** inspected the
  actual bundled `dist/chrome-mv3/chunks/sidepanel-BDTQn9Sp.js` for each
  change:
  - Tab strip array present verbatim in the minified bundle as
    `[{id:"mcp",label:"MCP"},{id:"tools",label:"Tools"},{id:"settings",label:"Settings"}]`
    — no `chat` entry, MCP first.
  - Default `activeTab` useState call present as `w("mcp")` (App component).
  - `showDiag` useState call present as `const[e,t]=w(!0)` in the
    `ConnectionHeader` component (`!0` === `true` in minified JS).
  - The string `"AI Provider Keys"` is **absent from the built bundle
    entirely** — the `SHOW_PROVIDER_KEYS = false` constant let the minifier
    (esbuild/Vite) dead-code-eliminate the whole section, including the text.
- **Store package:** `packages/extension/dist/agenthub-extension-v0.5.19.zip`,
  built from `dist/chrome-mv3` contents (manifest.json at zip root, not
  nested), 907,721 bytes. Verified with `unzip -l` that all 13 real files are
  present with forward-slash paths (the first attempt via PowerShell
  `Compress-Archive` produced backslash-separated paths, which is invalid for
  cross-platform zip consumers and was corrected using Windows' built-in
  `tar.exe` — bsdtar — in zip mode instead). Manifest version inside the zip
  confirmed as `0.5.19` via `unzip -p ... manifest.json`.

## 3. Logging / telemetry / privacy audit

This section is the factual answer to "what leaves the machine," verified by
reading the actual source (not inferred from docs, which — see below — are
partly stale).

### 3.1 Local NDJSON logging (bridge.log / extension.log / helper.log)

As documented in `CLAUDE.md`, all three files live under
`%LOCALAPPDATA%\agenthub\logs\`, written through a shared funnel:
`packages/native-host/src/shared/logger.ts`, function `logRecord()`
(lines ~266–304), with rotation at 1 MB / 4 kept generations.

- `bridge.log` and `helper.log` are written directly by their respective
  processes.
- `extension.log` is **not** written by the extension (MV3 service workers
  have no filesystem access). The extension buffers redacted log entries in
  `chrome.storage.local` (`packages/extension/src/shared/logger.ts`, key
  `__agenthub_log_buffer`, capped at 500 entries, FIFO drop-oldest) and
  forwards them over the existing WebSocket relay as
  `{ type: 'log_batch', entries }` frames
  (`packages/extension/src/background/connection-manager.ts`,
  `sendLogBatch()` / `startLogFlushTimer()`). The bridge receives this frame
  in `packages/native-host/src/service.ts` (~lines 706–726) and writes each
  entry to `extension.log` via the same `logRecord()` funnel used for
  `bridge.log`.
- Redaction (`packages/native-host/src/shared/redaction.ts` and the
  extension's own `packages/extension/src/shared/redaction.ts`) happens
  **before** entries reach the buffer/funnel: URLs collapse to scheme+host,
  page text becomes `[len=N]`, secrets become `[REDACTED-SECRET]`.

### 3.2 Remote log shipping to Neon Postgres — exists, default-on for packaged bridge binaries

**This is the one finding in this audit that is not summarized in
`CLAUDE.md`, and it needs to be flagged explicitly for the privacy
disclosure.** It does **not** affect a Chrome-Web-Store-only install (see
3.3), but it is real and already shipping in released native-host binaries
(present since commit `1028e5a`, contained in tags `v0.5.15`–`v0.5.19`).

- `packages/log-ingest/` is a separate Vercel serverless app in this monorepo
  (not part of the extension/native-host runtime packages) backed by Neon
  Postgres (`packages/log-ingest/api/logs.ts`, `neon(process.env.DATABASE_URL)`,
  batched `INSERT INTO logs (...)`).
- `packages/native-host/src/remote-sink.ts` is the bridge-side client. It taps
  into the exact same already-redacted record stream as the local log files
  (`setRemoteTee()` hook in `shared/logger.ts`) and POSTs batches (via
  `node:https`, no `fetch`) to a configured endpoint, tagged with a random
  per-install UUID (`installId`, persisted to `<installDir>/install-id`; not
  derived from user or hardware identity).
- **Precedence for whether it's active**
  (`remote-sink.ts` `readRemoteConfig()`, lines ~104–134):
  1. `logs-config.json` `{"enabled": false}` → off entirely (same
     kill-switch documented in `CLAUDE.md` for local logging).
  2. `logs-config.json` `{"remote": {"enabled": false}}` → explicit opt-out,
     off.
  3. Explicit endpoint+key in `logs-config.json` → used (this is how the
     opt-in e2e/soak tests exercise it against real Neon).
  4. **Otherwise, in a real compiled (`pkg`) binary, falls back to a
     baked-in default endpoint/key injected at build time** — no user action
     required, no visible consent UI. In a dev/`tsc` build there is no baked
     default, so it stays off.
- The build-time injection is wired in `.github/workflows/release.yml`
  (`build-native-host` job): `AGENTHUB_INGEST_ENDPOINT` /
  `AGENTHUB_INGEST_KEY` GitHub repo secrets are passed as env vars into
  `npm run compile:*` for every OS/arch, which `packages/native-host/scripts/build-bundle.mjs`
  injects via esbuild `define`. **I could not confirm from this environment
  whether those two secrets are currently set on the GitHub repo** (no `gh`
  CLI / repo-admin access here) — if they are set, every release binary since
  v0.5.15 ships bridge logs (and bridge-relayed extension logs) to Neon by
  default; if they were never set, the binaries build with empty defaults and
  remote shipping stays off everywhere except the explicit-opt-in dev/test
  path.
- `packages/log-ingest/README.md` states remote shipping is "off by default"
  and that baking in a default endpoint/key was deliberately "not done here."
  **That statement is stale/incorrect** relative to the current
  `remote-sink.ts` + `remote-defaults.ts` + CI wiring (commit `1028e5a`
  postdates it). This is a documentation bug, separate from this UI release,
  that should be corrected or the feature should be reconsidered — flagging
  it here rather than silently deferring it.

### 3.3 What a store-installed client actually gets

- **Chrome-Web-Store-only install, bridge never installed/run (the common
  case for a fresh CWS user before they run `npx agenthub-setup`):** logs
  stay entirely local to the browser profile, in `chrome.storage.local`
  (capped ring buffer, redacted, never a filesystem write, never IndexedDB).
  `sendLogBatch()` always returns `false` because there is no WS relay to a
  bridge, so the flush loop no-ops every interval — cheap, not an error, but
  nothing is ever delivered anywhere. **Nothing leaves the machine.** The
  remote-Neon capability lives exclusively in `packages/native-host`
  (the bridge process) and is structurally unreachable without it — confirmed
  by a repo-wide search of `packages/extension/src` for `neon`/`ingest`/
  `vercel` (zero matches) and for hardcoded non-localhost hosts (only the
  three AI chat provider APIs — `api.anthropic.com`, `api.openai.com`,
  `generativelanguage.googleapis.com` — which are separate, out of scope of
  logging, and gated by the now-hidden Chat tab in this release).
- **Store-installed client that also runs the AgentHub installer / bridge**
  (needed for MCP — the extension's core value prop): local NDJSON logging as
  in 3.1, **plus**, if the release binary they downloaded was built with the
  CI secrets set (unverified from here, see 3.2), best-effort batched
  shipping of the same redacted records to Neon Postgres, off-able per-machine
  by dropping `{"enabled": false}` in `%LOCALAPPDATA%\agenthub\logs-config.json`
  and restarting the bridge.
- **Explicit privacy statement:** page content, URLs, and secrets are redacted
  before they ever reach either the local log files or the remote sink — the
  redaction step is shared and happens upstream of both. The AI chat feature
  (hidden in this release) sends full page/user content directly to the
  configured provider's API (OpenAI/Anthropic/Gemini) when used — that is
  separate product functionality, not logging, and is unreachable in this
  release since the Chat tab and provider-key UI are both hidden.

## 4. Known limitations

- The chat-tab bug that motivated this release is **not fixed** — `chat-tab.tsx`
  and `chat-engine.ts` are untouched and still fully wired into the app
  (mounted, just not reachable via the nav). If any other code path can flip
  `activeTab` to `'chat'` in the future (e.g. a new deep link), the bug is
  still live.
- Provider-key storage/logic is intact and still readable/writable by anyone
  with access to the extension's `chrome.storage.local` (e.g. via
  `chrome.storage.local.get` from an extension debug context) — hiding the UI
  does not clear or lock any previously-saved keys.
- The Neon remote-log-shipping default-on behavior (3.2) predates this
  release and is unrelated to the four UI changes, but is a standing privacy
  fact worth the team confirming/deciding on before or shortly after this
  store submission, since it's undocumented in `CLAUDE.md` and contradicts
  `packages/log-ingest/README.md`.
- No CWS-specific manual QA (load-unpacked smoke test, screenshot review in
  an actual Chrome profile) was performed as part of this task — verification
  was build/bundle/test-based only, per the coordinator's instructions.

## 5. Rollback notes

All four changes are single, clearly-commented toggles. To restore any of
them:

1. **Chat tab:** in `packages/extension/src/entrypoints/sidepanel/main.tsx`,
   uncomment `{ id: 'chat', label: 'Chat' }` in the `tabs` array inside
   `TabStrip`.
2. **Provider keys:** in `packages/extension/src/sidepanel/components/settings-tab.tsx`,
   flip `const SHOW_PROVIDER_KEYS = false` to `true`.
3. **Tab order/default:** in `main.tsx`, reorder the `tabs` array and/or
   change `useState<TabId>('mcp')` back to `useState<TabId>('chat')` (or
   whatever order is desired).
4. **Diagnostics default:** in `packages/extension/src/sidepanel/components/connection-header.tsx`,
   flip `useState(true)` back to `useState(false)` for `showDiag`.

Each is a one-line change; no data migration or storage schema is affected by
any of them.

## 6. Store upload checklist

- [x] `npm test` green in `packages/extension` (357/357).
- [x] `npm run build` clean.
- [x] Built output inspected for all four changes (not just "build succeeded").
- [x] `agenthub-extension-v0.5.19.zip` built with `manifest.json` at zip root,
      forward-slash paths, size 907,721 bytes.
- [ ] Manual smoke test: load the zip's contents unpacked in a clean Chrome
      profile, confirm side panel opens on MCP tab, Chat/Provider-Keys are not
      visible anywhere, diagnostics panel is expanded by default. (Not done
      as part of this task — recommended before actual store submission.)
- [ ] Chrome Web Store listing's privacy disclosure reviewed against §3 above
      (in particular: confirm whether the "does this extension collect data"
      answers need updating given the Neon path exists downstream in the
      bridge, even though the extension itself never talks to it directly).
- [ ] Upload `agenthub-extension-v0.5.19.zip` via the Chrome Web Store
      Developer Dashboard, submit for review.
- [ ] Tag/track this as a UI-only release; the underlying chat bug and the
      remote-logging documentation mismatch remain open follow-ups.
