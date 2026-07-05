# Side panel: MCP tab relocation + connection-recovery UX

_Branch: `multi-client-architecture` · 2026-07-05 · UI/UX only_

## Why

AgentHub works in two modes:

- **Chat-only (no MCP):** install the extension, paste an LLM API key, use the
  chat sidebar + browser tools. Needs **no** bridge, native host, or
  `npx agenthub-setup` — tools dispatch locally in the service worker.
- **MCP mode:** an external client (Claude Desktop / Cursor / ChatGPT) drives the
  browser via the bridge/native host, which `npx agenthub-setup` installs.

Previously the side panel rendered the connection/bridge status header at the
**top of every tab**. A chat-only user who never wanted MCP was greeted with
bridge/connection/install errors that are irrelevant to them, making a working
product look broken. This change moves that surface out of the way **without
changing any connection-discovery behavior, backend, or bridge code.**

## What changed

### 1. New "MCP" tab; connection status relocated

- Tab strip is now **Chat · Tools · MCP · Settings** (default: Chat).
- `ConnectionHeader` (+ its diagnostics panel) and the `OutdatedBridgeBanner`
  moved from the top of the shell into the **MCP tab** (`McpTab`).
- First-launch onboarding (`SetupWizard`) no longer takes over the whole screen —
  it renders **inside** the MCP tab when `needsSetup` is true. A brand-new
  chat-only user lands on Chat with no MCP errors at top level.
- Panels stay mounted (toggled with `hidden`), so the relocated
  `ConnectionHeader` keeps computing its verdict while hidden — **discovery is
  unchanged.**

### 2. Global vs. tab-scoped banner rule

> A banner stays **global** (above the tab strip, visible from every tab) **iff**
> it gates a capability usable from the current tab regardless of tab. MCP /
> bridge / install-only messages move to the MCP tab.

- **`SiteAccessBanner` stays global** — `<all_urls>` access gates content tools
  (`get_page_content`, `click_element`, …) used from the **Chat** tab.
- `ConnectionHeader`, `OutdatedBridgeBanner`, `SetupWizard` → MCP tab.

### 3. Conservative MCP-tab attention badge

Because the header is no longer top-visible, the **MCP tab label** shows a small
`!` when — and only when — the user has actually connected MCP before **and**
there is a real fault. New pure helper `mcpTabNeedsAttention()`:

```
hasEngagedMcp && severity !== 'ok' && ATTENTION_KINDS.has(kind)
```

- `hasEngagedMcp = connectionContext.lastConnectedAt != null` (not
  `setupComplete`, which is polluted by the wizard "skip" button).
- `ATTENTION_KINDS` excludes `untested` / `connecting` / `working` → a brand-new
  chat-only user is **never** badged.
- Badge is icon + visually-hidden text + `aria-label` + an `aria-live` region
  (never color alone).

### 4. Flapping recovery: tell the user what to actually do

The "Connection keeps dropping" verdict used to say *"A restart usually clears
this up"* — vague, and a bare restart does **not** fix the most common cause
(the extension's origin missing from the bridge allowlist →
`origin_not_in_allowlist`). Now:

- Subtitle points to **re-running setup**: copy the setup command and run it.
- Primary action is **"Copy setup command"** (re-run npx); **Restart bridge** and
  **Reload extension** remain as secondary fallbacks.
- The copied command now includes the live **extension ID**
  (`npx agenthub-setup@latest --update --extension-id <id>`) so it re-registers
  this extension with the bridge — the real fix.

Only the flapping verdict's **message/actions** changed; the **detection
condition** (when flapping fires) is untouched.

### 5. Popup connection status hidden (not removed)

The browser-action popup no longer shows the connection dot/label — it isn't
tab-scoped and duplicated a signal that now lives in the MCP tab. Gated behind
`const SHOW_CONNECTION_STATUS = false;`; all status logic + live-update listeners
are kept intact. Flip the flag to restore.

## Tests

- `mcp-tab-attention.test.ts` (new) — badge truth table.
- `main.test.tsx` (new) — first-launch lands on Chat with no top-level MCP error;
  `ConnectionHeader` lives inside the hidden MCP panel; `SiteAccessBanner` renders
  from every tab.
- `popup/main.test.ts` (new) — popup renders only the "Open Side Panel" button,
  no status indicator.
- `connection-verdict.test.ts` / `connection-header.test.ts` — updated flapping
  assertions (primary action = `copy_install_command`, restart still offered).

Test infra: added `jsdom` devDependency + `.test.tsx` include and preact/compat
aliases in `vitest.config.ts` for the DOM/component tests.

## Explicitly NOT changed

Connection discovery / state machine (`connection-verdict.ts` detection,
`connection-manager.ts`, heartbeat, relay, `/api/state` polling), any
`background.ts` / native-host / bridge / installer logic. This is a UI-surface
change only.

## Verification

- Extension suite: **338 tests / 25 files green**.
- `tsc --noEmit`: baseline error count only (0 introduced).
- `wxt build` clean; `dist/chrome-mv3` rebuilt.
