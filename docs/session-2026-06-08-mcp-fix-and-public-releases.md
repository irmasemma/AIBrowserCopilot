# Session log — 2026-06-05 → 2026-06-08

MCP §21 envelope-translation fix + public release-assets channel.

Author: Claude Opus 4.7 (working with @irmasemma).

This document is intentionally exhaustive so a future Claude / LLM session
can pick up where this one left off without re-investigating.

---

## Table of contents

1. [TL;DR](#1-tldr)
2. [What was wrong (the §21 bug, properly diagnosed)](#2-what-was-wrong-the-21-bug-properly-diagnosed)
3. [The fix shipped — Layers 1+2](#3-the-fix-shipped--layers-12)
4. [Why scope was trimmed mid-session](#4-why-scope-was-trimmed-mid-session)
5. [Tests added (unit + E2E)](#5-tests-added-unit--e2e)
6. [The release-channel problem we discovered](#6-the-release-channel-problem-we-discovered)
7. [agenthub-releases — the public binary mirror](#7-agenthub-releases--the-public-binary-mirror)
8. [v0.5.5 release pipeline](#8-v055-release-pipeline)
9. [Things to know for future sessions](#9-things-to-know-for-future-sessions)
10. [What remains to do (and who does it)](#10-what-remains-to-do-and-who-does-it)
11. [False starts and dead ends (so you don't repeat them)](#11-false-starts-and-dead-ends-so-you-dont-repeat-them)
12. [Code reference index](#12-code-reference-index)

---

## 1. TL;DR

We fixed two problems that compound:

1. **MCP tools returned silent empty results** when the extension threw any
   error. Root cause: the bridge did `result: resp.result ?? resp`, which
   leaked the raw `tool_error` envelope as the MCP `result` — MCP clients
   then saw no `content` array and rendered nothing.
2. **Anonymous installer downloads (`npx agenthub-setup --update`) 404'd**
   because GitHub returns 404 for `/releases/latest/download/<asset>` URLs
   on private repos. The source repo `irmasemma/AIBrowserCopilot` is
   private; every customer was stuck on whatever binary they originally
   downloaded, with no working update path.

Shipped:

- v0.5.5 release with the MCP envelope-translation fix in the bridge
- New public mirror repo `irmasemma/agenthub-releases` (binaries only, no
  source) that the installer now points at
- CI workflow dual-publishes to both repos on every `v*` tag
- 7 new native-host unit tests + 2 new E2E tests guarding the fix

Outstanding: `agenthub-setup@0.5.5` not yet `npm publish`'d. Until that
runs, customers' `--update` command still pulls the v0.5.4 installer that
points at the OLD (private repo) URL and 404s. See §10.

---

## 2. What was wrong (the §21 bug, properly diagnosed)

### The symptom (from the prior session log §21)

External MCP clients (Claude Code, Cursor, anything talking the MCP
protocol over our bridge) saw `list_tabs` work normally — array of tabs
returned, all good. But `take_screenshot`, `get_page_content`, `snapshot`,
`get_page_metadata`, `navigate` all returned empty: no image, no text, no
error message — just nothing. Users had no recovery path because nothing
told them what went wrong.

### The prior session's (wrong) diagnosis

That session (docs/session-2026-06-04-postdownloader-overhaul.md §21)
attributed it to:
- MV3 service-worker eviction (`ERR_NETWORK_IO_SUSPENDED` in browser console)
- "list_tabs is served by the MCP bridge via CDP, no WS to extension needed"

Both claims are wrong. Don't rebuild on top of them in future sessions.

### The actual root cause (two compounding bugs)

**Bug A — Schemas lied about `tab_id`.**
Commit `4ee5e28` (May 9, 2026 — "feat(multi-profile): tab activation,
fan-out, SW eviction prevention") explicitly removed the active-tab
fallback in `packages/extension/src/background/tool-dispatcher.ts:209-216`.
The comment in that file says:

> "Active-tab fallback was removed: with multiple windows or profiles,
> the 'current window' semantics silently re-targeted mid-task… Callers
> must now pass an explicit tab_id."

But none of the 14 tab-targeting tool schemas in
`packages/native-host/src/tools/*.ts` were updated. They still advertised:

```ts
tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab).'),
```

External MCP clients read that schema, omitted `tab_id`, and triggered the
error path immediately.

**Bug B — Native host leaked the extension's error envelope as the MCP
result.**

When the extension threw, it sent over the WebSocket:
```json
{ "type": "tool_error", "id": "b_req_xxx", "error": { "message": "...", "code": "..." } }
```

The bridge's `handleMcpMessage` `tools/call` success path did:
```ts
const resp = response as { result?: unknown };
reply({ jsonrpc: '2.0', id: msg.id, result: resp.result ?? resp });
```

`resp.result` is undefined for the error envelope, so `resp` (the whole
`tool_error` object) was used as the MCP `result`. MCP clients then saw:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "type": "tool_error", "error": {...} } }
```

There's no `result.content` array. Per the MCP spec, that's an invalid
tool result. Most clients (Claude Code in particular) render this as
silent nothing — no error message surfaced to the user.

### Why `list_tabs` escaped both bugs

- It doesn't need `tab_id` (uses `chrome.tabs.query({})`)
- It always returns a properly-formed `{ content: [{type:'text', text}] }`
  envelope
- So neither bug triggered for that tool. From outside, it looked like
  routing was somehow special for list_tabs. It's not — list_tabs is
  served by the same `ws.send()` to the extension as every other tool,
  through `fanOutToolRequest` in `service.ts:607-627`. There's no CDP path
  in this repo at all.

---

## 3. The fix shipped — Layers 1+2

Started with a 4-layer "principal-engineer" fix (envelope translation +
honest schemas + JSON-Schema `required` emission + host-side pre-validation
+ host-side pre-validation flag on `ToolPlugin`). User pushed back on
scope. Trimmed to the two layers that carry actual robustness:

### Layer 1 — Translate extension wire envelopes to MCP

New `translateExtensionResponse()` in `packages/native-host/src/service.ts`.
Handles three shapes the extension can emit:

| Extension wire shape | Translated MCP result |
|---|---|
| `{ type: 'tool_error', error: { message, code } }` | `{ content: [{type:'text', text: message}], isError: true }` |
| `{ type: 'tool_response', result: { content: [...] } }` | Passes `result` through unchanged |
| `{ id, error: { message } }` (top-level JSON-RPC) | `{ content: [{type:'text', text: message}], isError: true }` |
| Anything else | `{ content: [{type:'text', text: JSON.stringify(response)}] }` (with `?? String(response)` guard against `JSON.stringify(undefined)` returning value undefined) |

Also fixed the parallel bug in `mergeFanOutListTabs` — added a `type: 'tool_error'`
check at the top of the loop, before the existing `{ error }` and
`{ result: { isError } }` checks.

### Layer 2 — Stop lying in tool schemas

All 14 tab-targeting tools in `packages/native-host/src/tools/*.ts`:
- `tab_id: z.number().optional().describe('… defaults to active tab')`
  → `tab_id: z.string().describe('Required. Tab ID returned by list_tabs (format: "<brand>:<uuid>:<rawId>"). Call list_tabs first if you do not have one.')`
- Removed unused `url` parameter from `get_page_content` and
  `get_page_metadata` (the dispatcher had been silently ignoring it)
- `list_tabs.ts` was NOT touched — it's the only tool that legitimately
  doesn't need a tab_id

### Why no Layer 3 (JSON-Schema `required`) or Layer 4 (host pre-validation)

Layer 1 fixes the error-rendering bug (every tool error surfaces readably
now). Layer 2 reduces error-path triggers (LLM sees honest schema, calls
list_tabs first). Together they cover the user-visible bug. Adding
JSON-Schema `required` emission would matter only for schema-strict
clients (vanishingly rare), and host-side pre-validation just saves a
30-second round-trip when the SW is suspended (nice-to-have, not bug fix).
The trimmed scope is +260/-39 lines instead of +630/-51.

---

## 4. Why scope was trimmed mid-session

User asked: "why you applied so many changes. Are you sure we need them?"

The rubber-duck-style answer: every additional line of code is surface
area for new bugs. The 4-layer version delivered the same user-visible
robustness as the 2-layer version, just with more belt-and-suspenders.
For a fix that affects production users, surgical is better.

Documented in commit message; preserved in this doc so the next session
knows the cut wasn't laziness.

---

## 5. Tests added (unit + E2E)

### Unit tests

`packages/native-host/src/service.test.ts` (+4 tests):

| Test | What it verifies |
|---|---|
| `translateExtensionResponse: tool_error → isError result` | The exact §21 bug fix |
| `translateExtensionResponse: tool_response passthrough` | Success path preserved |
| `translateExtensionResponse: null/undefined safety` | Guards against `JSON.stringify(undefined)` returning value undefined (would re-create the empty-text bug) |
| `mergeFanOutListTabs: tool_error envelope handling` | The parallel bug in the fan-out path |

`packages/native-host/src/tools/tools.test.ts` (+3 tests):

| Test | What it verifies |
|---|---|
| No tab_id field description mentions "active tab" | Regression lock against re-introducing the lie |
| tab_id is required ZodString on every tab-targeting tool | Schema invariant |
| tab_id description mentions list_tabs | LLM has recovery hint |

`packages/installer/src/shared/constants.test.ts` (+1 test):

| Test | What it verifies |
|---|---|
| `GITHUB_REPO === 'irmasemma/agenthub-releases'` | Locks the constant to the public mirror; future drift would silently re-break installs |

### E2E tests

`tests/e2e/multi-profile-fanout.spec.ts` (+2 tests):

These run inside the existing `multi-profile-fanout` describe — it already
spawns the real bridge AND has a real extension connected via Playwright's
bundled Chromium, so it can exercise the full bridge ↔ extension wire path.

| Test | What it verifies |
|---|---|
| `tools/call WITHOUT tab_id returns non-empty isError result` | End-to-end §21 regression — connects to bridge as MCP client over WS, omits tab_id, asserts response has populated `content` array with readable error text |
| `tools/call successful list_tabs returns populated content array` | Success path through the translator is uncorrupted |

These caught one bug during development: the bridge `beforeAll` setup was
respecting the production extension-ID allowlist file, which rejected
Playwright's bundled-Chromium extension (different path-derived ID). Fix:
spawn the test bridge with `LOCALAPPDATA` pointed at a fresh temp dir, so
the bridge can't find `extension-ids.json` and falls back to
"accept any chrome-extension:// origin" (back-compat mode).

### Test results at commit time

- 92 native-host unit tests pass
- 311 installer unit tests pass
- 200 extension unit tests pass (unchanged)
- 20 native-host-helper unit tests pass (unchanged)
- 11 multi-profile-fanout E2E tests pass (added 2)

---

## 6. The release-channel problem we discovered

While testing, user ran on a clean machine:
```
> npx agenthub-setup@latest --update --extension-id <id>
✗ Download failed after 3 attempt(s): Download failed with status 404
```

Diagnosis:
- `agenthub-setup` v0.5.4 fetches binaries from
  `https://github.com/irmasemma/AIBrowserCopilot/releases/latest/download/agenthub-win-x64.exe`
- The release exists, the asset exists, but the URL returns 404
- `gh repo view irmasemma/AIBrowserCopilot --json isPrivate`
  → `{"isPrivate": true}`
- GitHub returns 404 for `/releases/latest/download/<asset>` URLs on
  private repos when called without authentication

The whole installer download path has been broken since the repo went
private. No customer can install or update via the published
`agenthub-setup`. This is independent of the §21 MCP bug; even if the
MCP bug were fixed, customers couldn't get the fixed binary.

This was a pre-existing infra issue this session inherited and addressed.

---

## 7. agenthub-releases — the public binary mirror

User created `irmasemma/agenthub-releases` as a public repo (no source,
just a place to attach release assets). The session:

1. Initialized the empty repo with a README (it had no commits, no
   branches; `gh release create` can't attach a tag to nothing — that's
   the `HTTP 422: Invalid target_commitish` error)
2. Updated `packages/installer/src/shared/constants.ts`:
   ```ts
   export const GITHUB_REPO = 'irmasemma/agenthub-releases';
   ```
3. Added a lock-down test (`constants.test.ts`) so a future careless edit
   reverting to the private repo would fail in CI

### Why a separate public repo (vs making the main repo public)

- Source code stays private (proprietary, contains internal docs, etc.)
- Only ~7 compiled `.exe` files per release become public
- Customers' `npx agenthub-setup` calls anonymous `/releases/latest/download/`
  URLs — works on public repos, 404s on private ones
- Standard pattern: VS Code does this with `vscode-distro`, Cursor with
  `cursor-releases`, etc.

### What the public repo contains

Only:
- README.md (explains what the repo is and links back)
- Release tags with binary assets attached

No source files. No commits past the initial README. The CI workflow
publishes binaries via `gh release create --repo irmasemma/agenthub-releases`
without checking out any code there.

---

## 8. v0.5.5 release pipeline

### Versions bumped

- Root `package.json` 0.5.4 → 0.5.5
- `packages/installer/package.json` 0.5.4 → 0.5.5
- `packages/native-host/package.json` 0.5.4 → 0.5.5
- `packages/native-host-helper/package.json` 0.5.4 → 0.5.5
- `packages/extension/package.json` 0.5.4 → 0.5.5
- `packages/extension/wxt.config.ts` `version: '0.5.5'`
- `packages/native-host/src/version.ts` `VERSION = '0.5.5'`

### CI workflow changes

`.github/workflows/release.yml`: kept the original "release in this repo"
step (uses default `GITHUB_TOKEN`, works on tag push). Added a new step
after it that publishes to `irmasemma/agenthub-releases`:

```yaml
- name: Create GitHub Release (public repo — customer-facing downloads)
  env:
    GH_TOKEN: ${{ secrets.PAT_RELEASES_PUBLIC }}
  run: |
    # ... idempotent delete + recreate ...
    gh release create "$TAG" --repo irmasemma/agenthub-releases \
      --title "$TAG" --generate-notes ... public-release-assets/*
```

### Required GitHub repo secret

`PAT_RELEASES_PUBLIC` must be set on `irmasemma/AIBrowserCopilot` (private
repo, where CI runs). It's a fine-grained PAT with:
- Repository access: only `irmasemma/agenthub-releases`
- Permissions → Repository → Contents: Read and write

Verify with: `gh secret list --repo irmasemma/AIBrowserCopilot`

### Release outcome (v0.5.5, June 8, 2026)

```
Private repo (irmasemma/AIBrowserCopilot):
  v0.5.5 — Latest — 2026-06-08

Public repo (irmasemma/agenthub-releases):
  v0.5.5 — Latest — 2026-06-08
```

Anonymous download verified working:
```
$ curl -sI https://github.com/irmasemma/agenthub-releases/releases/latest/download/agenthub-win-x64.exe
HTTP/1.1 302 Found
Location: .../v0.5.5/agenthub-win-x64.exe
```

### The first run failed

The first CI run on the v0.5.5 tag succeeded at building all 5 platform
binaries but failed at the "publish to public repo" step with:
`HTTP 422: Invalid target_commitish parameter`. Root cause: the public
repo was a brand-new empty repo (no commits, no default branch). `gh
release create` needs SOMETHING to attach the tag to. Fixed by cloning
the empty repo, pushing a README on `main`, then running
`gh run rerun <id> --failed`. The rerun succeeded in ~10 seconds.

---

## 9. Things to know for future sessions

### Architectural facts that didn't exist before this session

- `GITHUB_REPO` in `packages/installer/src/shared/constants.ts` is now
  `irmasemma/agenthub-releases`, NOT `irmasemma/AIBrowserCopilot`. There's
  a test that fails if anyone changes this back.
- CI workflow has TWO release-publishing steps now. Both must succeed for
  a release to reach customers. If `PAT_RELEASES_PUBLIC` ever expires or
  gets revoked, customer downloads break silently (the private-repo step
  still succeeds, so the release LOOKS done from the maintainer's side).
- The public repo `irmasemma/agenthub-releases` is the customer-facing
  URL. Don't put source code, internal notes, or anything sensitive there.
- The compiled `.exe` reports VERSION via `--version` and `server_info`;
  it's the canonical authority on what's running. Run
  `%LOCALAPPDATA%\agenthub\agenthub-win-x64.exe --version` to verify.

### Stale CLAUDE.md content (still needs updating)

CLAUDE.md line 99 says:
> Google Chrome stable (138+) silently ignores `--load-extension` and
> `--disable-extensions-except` — only Chromium / Chrome Canary / Beta /
> Dev / Edge accept them.

**This is no longer fully accurate.** Chrome Dev 151 also now blocks
`--load-extension`. The session ran Chrome Dev's verbose log and saw:
```
WARNING: --load-extension is not allowed in Google Chrome, ignoring.
```
Only Playwright's bundled Chromium and Microsoft Edge still honor the
flag reliably. CLAUDE.md should be updated when convenient.

Line 90 says:
> Extension ID (dev, Profile 1): `ehchmchlmggdigicfjfmlgcbhdcdcmll`

This is the path-derived ID for whoever computed it. On any new clone, the
ID will differ because the path differs. For this clone:
```
Path: Q:\One\Networking\browserCopilot\AIBrowserCopilot\packages\extension\dist\chrome-mv3
Path-derived ID: mnhdlpdifaanpepleibegihaaaohdofk
```

### Things the user has done locally that aren't in the repo

- `%LOCALAPPDATA%\agenthub\extension-ids.json` was at one point set to
  the placeholder `"myext123"`. This session fixed it to the real
  path-derived ID for this clone. If you clone fresh onto a new machine,
  this file gets regenerated correctly by the installer when run with
  `--extension-id <id>`.
- A stale `server.lock` file with a dead PID was cleaned up.
- The installed `%LOCALAPPDATA%\agenthub\agenthub-win-x64.exe` was
  hand-copied from the build output at one point to test before the CI
  release. After the v0.5.5 release, customers get the same binary via
  the normal install path.

---

## 10. What remains to do (and who does it)

### Required for end-to-end customer recovery

**The user must run `npm publish`.** The `agenthub-setup` package on
npm registry is still v0.5.4 with the old (broken) URL pointing at the
private repo. Until v0.5.5 is published to npm, customers running
`npx agenthub-setup@latest --update` get the v0.5.4 installer and 404.

```powershell
cd Q:\One\Networking\browserCopilot\AIBrowserCopilot\packages\installer
npm publish
```

Requires `npm login` with credentials owning the `agenthub-setup` package.

### Nice-to-have

- Update CLAUDE.md to reflect that Chrome Dev now also blocks
  `--load-extension`
- Consider adding `key` field to `wxt.config.ts` so dev builds across
  machines all get the same stable extension ID instead of path-derived
  variants (needs CWS public key)
- Consider adding `--target main` to the `gh release create --repo
  irmasemma/agenthub-releases` call in CI so future "empty repo" startups
  don't break the workflow

### Already done

- Bridge code fix shipped in commit b7c0c6b
- v0.5.5 tagged + pushed
- Private repo release created (CI)
- Public repo release created with all 5 platforms (CI rerun, after fix)
- Anonymous download URL verified (HTTP 302)
- All tests pass on the changes

---

## 11. False starts and dead ends (so you don't repeat them)

### Don't waste time on these

1. **"Make the real-browser test attach to user's Chrome Stable"** — Chrome
   Stable 138+ permanently blocks `--load-extension`. The test infra
   already documents this (`docs/test-findings.md` §4). Use Playwright's
   bundled Chromium for any test that needs to load the unpacked extension.

2. **"Install Chrome Dev to bypass the Chrome Stable block"** — Chrome Dev
   151 now also blocks `--load-extension`. Both produce the same `WARNING:
   --load-extension is not allowed in Google Chrome` log line. See §9.

3. **"Manually 'Load unpacked' via Playwright"** — Playwright can drive
   the chrome://extensions/ UI but the "Load unpacked" button opens a
   native OS file picker that Playwright cannot interact with. There are
   workarounds (chrome.developerPrivate.loadDirectory, CDP
   Extensions.loadUnpacked) but they're complex; Playwright's bundled
   Chromium is the path of least resistance.

4. **"Test on real Edge"** — On this machine, real Edge 149 launches but
   immediately exits when launched with `--remote-debugging-pipe` (the
   flag Playwright uses). Possibly corporate Group Policy, possibly
   Edge-version-specific. Not worth chasing for this kind of test.

5. **Hardcoded extension ID `ehchmchlmggdigicfjfmlgcbhdcdcmll`** — This is
   the ID for one specific clone of the repo. Path-derived IDs vary by
   machine. The CLAUDE.md note about this ID is informational, not
   authoritative. For tests that need to know the ID, derive it from the
   path with the `deriveExtensionIdFromUnpackedPath` algorithm (SHA256
   of UTF-8 path → first 16 bytes → each byte split into two chars in
   'a'..'p' range).

### Don't repeat the prior session's wrong diagnosis

The session at docs/session-2026-06-04-postdownloader-overhaul.md §21
attributed the bug to SW eviction and an imagined CDP path. There's no
CDP code in this repo. SW eviction is real but explains different
symptoms (occasional connection drops, not the "list_tabs works /
everything else empty" pattern). The bug was the envelope translation,
nothing more.

---

## 12. Code reference index

### Files changed in commit b7c0c6b

**Bridge fix:**
- `packages/native-host/src/service.ts` — new `translateExtensionResponse()`,
  updated `mergeFanOutListTabs`, wired translator into `tools/call` handler
- `packages/native-host/src/service.test.ts` — 4 new tests
- `packages/native-host/src/tools/*.ts` (14 files) — schema fix:
  `tab_id` is now required string, no "active tab" lies, list_tabs untouched
- `packages/native-host/src/tools/tools.test.ts` — 3 new schema invariant tests
- `packages/native-host/src/version.ts` — VERSION bump
- `packages/native-host/bin/bundle.cjs` — esbuild output (committed because
  the workflow uses it)
- `packages/native-host/bin/agenthub-win-x64.exe` — pkg-compiled binary
  (committed; CI rebuilds this on tag push, but the committed version is
  always the local build)

**Public release channel:**
- `packages/installer/src/shared/constants.ts` — `GITHUB_REPO` switched
- `packages/installer/src/shared/constants.test.ts` — lock-in test
- `packages/installer/package.json` — version bump
- `.github/workflows/release.yml` — added public-repo publish step

**Version bumps elsewhere:**
- `package.json`
- `packages/extension/package.json`
- `packages/extension/wxt.config.ts`
- `packages/extension/dist/chrome-mv3/manifest.json` (extension is tracked
  in git — see `.gitignore` `!packages/extension/dist/`)
- `packages/native-host-helper/package.json`

**E2E tests:**
- `tests/e2e/multi-profile-fanout.spec.ts` — added §21 regression describe
  block (+2 tests). Also tweaked `beforeAll` to spawn the bridge with
  `LOCALAPPDATA` pointed at a temp dir so it doesn't read the production
  extension-ids allowlist.

### Files NOT changed (notable)

- `packages/extension/src/sidepanel/openai-tools.ts` — sidepanel chat
  schemas were considered, but the sidepanel injects `boundTabId`
  automatically via chat-engine.ts, so the schema text doesn't drive
  LLM behavior the same way. Reverted to avoid unnecessary change.
- `packages/extension/src/background/tool-dispatcher.ts` — already
  correctly throws "tab_id is required" when missing. No change needed.
- `packages/extension/src/background/relay-client.ts` — already
  correctly sends `{ type: 'tool_error', error: { message, code } }`.
  The bridge just wasn't reading it correctly.

---

## Decision log

| Decision | Rationale |
|---|---|
| Trim from 4-layer to 2-layer fix | User pushback. Same user-visible robustness, half the lines, less surface area for new bugs. |
| Don't restore active-tab fallback | The 4ee5e28 removal was deliberate to fix silent multi-window misroutes. Restoring would re-create that bug. |
| Use Playwright bundled Chromium for the E2E test | The user's Chrome Stable + Chrome Dev both block `--load-extension`. Bundled Chromium is the only browser still honoring it that runs reliably on this machine. |
| Use separate public repo for releases | Source stays private (proprietary). Only compiled binaries are public. Standard industry pattern. |
| Keep CI publishing to private repo too | Maintainer tooling, internal tracking, release notes generation all depend on it. Dual-publish is cheap. |
| Bump version to 0.5.5 (not 0.6.0) | Bug fix + infra change for the install pipeline. Neither is a breaking API change. |

---

## Verification commands

For future Claude / LLM sessions or another machine, here's the smoke test
chain that proves the fix is in place and reaching customers:

```powershell
# 1. Confirm v0.5.5 exists in both repos
gh release list --repo irmasemma/AIBrowserCopilot --limit 3
gh release list --repo irmasemma/agenthub-releases --limit 3

# 2. Confirm anonymous download works from the public repo
curl -sI "https://github.com/irmasemma/agenthub-releases/releases/latest/download/agenthub-win-x64.exe" | head -3
# Expected: HTTP/1.1 302 Found, Location: .../v0.5.5/...

# 3. Confirm the installed binary reports v0.5.5
& "$env:LOCALAPPDATA\agenthub\agenthub-win-x64.exe" --version
# Expected: 0.5.5

# 4. Confirm the npm package is up to date (run AFTER `npm publish` happens)
npm view agenthub-setup version
# Expected eventually: 0.5.5 (currently 0.5.4 until publish)

# 5. Run the regression tests
cd packages/native-host && npm test                          # 92 should pass
npx playwright test tests/e2e/multi-profile-fanout.spec.ts   # 11 should pass
```

If steps 1-3 pass but step 4 still shows 0.5.4, the npm publish step from
§10 hasn't been run yet.
