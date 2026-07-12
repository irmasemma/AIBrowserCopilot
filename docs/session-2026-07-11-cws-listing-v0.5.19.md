# Session 2026-07-11 — Chrome Web Store listing rework for v0.5.19

Goal: make the CWS listing truthful for the v0.5.19 store-safe build (Chat tab +
AI-provider-key fields hidden), refresh title/summary, and prepare the upload
package. Submission itself was deliberately left manual.

## What changed

### Manifest (`packages/extension/wxt.config.ts`)
- `name`: `AgentHub — Browser MCP for Claude & Cursor` → **`AgentHub — Browser MCP for Claude Code & Cursor`** (47/75 chars)
- `description`: → **`AgentHub — Browser MCP for Claude Code, Cursor & Claude Desktop. Automate your real Chrome via MCP tools.`** (105/132 chars)
- Rationale (smm-growth-marketer agent, adversarially constrained to verified v0.5.19 facts):
  - CWS **Title** and **Summary** are read-only in the dev console — they come from the
    manifest `name`/`description` of the uploaded package. Changing them requires
    rebuild + re-zip + re-upload, not a console paste.
  - Only Claude Code, Cursor, Claude Desktop are tested/documented clients. Naming
    untested clients (VS Code/Copilot, Windsurf, …) in the title implies support we
    can't back, and >2–3 third-party trademarks in a title risks CWS metadata-spam
    rejection. "Claude Desktop" was dropped from the *title* (same-vendor duplicate of
    "Claude Code" for search purposes) but stays in summary + description.

### Store description (`docs/store-description-minimal.txt`)
Rewritten to be truthful for v0.5.19. This file is now the paste source for the CWS
"Description" field. Removed/never-reintroduce claims:
- Built-in chat / chat sidebar / "Chat with OpenAI" — **hidden in v0.5.19**
- BYOK / API-key language, provider model lists (GPT/Gemini/Claude models)
- "No open ports, no network sockets" — **false**: bridge listens on localhost
  (127.0.0.1) WS/HTTP. Correct phrasing: "listens only on localhost".
- "audited binary" — no audit exists
- "debugger permission optional/off by default" — **false**: `debugger` is a required
  permission (screenshots via CDP since v0.5.13)
- Blanket "no telemetry / no backend" — **false for the release binary** (see finding
  below)
Tool capabilities listed now map 1:1 to the shipping MCP tools (tool-dispatcher.ts).

### Package
`packages/extension/dist/agenthub-extension-v0.5.19.zip` rebuilt (wxt build →
Compress-Archive of `dist/chrome-mv3/*`). Verified: manifest name/description/version
correct, zip contents exactly match build output, all manifest-referenced assets
(icons 16/48/128, popup, sidepanel, background) present. Note: there is **no npm zip
script** — the zip is produced manually as above.

## Findings / flags (NOT yet resolved)

1. **Telemetry disclosure gap (pre-submission blocker).** The compiled release binary
   ships redacted diagnostic logs to a remote ingest endpoint (Vercel → Neon) **by
   default**, opt-out via `logs-config.json`. See
   `packages/native-host/src/remote-defaults.ts` (build-time-injected endpoint/key) and
   `remote-sink.ts`. This contradicts "no telemetry / no backend" claims in
   `docs/store-listing.md`, likely `docs/privacy-policy.md`, and whatever the CWS
   **Privacy Practices tab** currently declares. Before submitting: either disclose the
   redacted-diagnostics collection there, or flip the default to opt-in.
2. **Unused host permissions.** v0.5.19 manifest still requests
   `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` in
   `host_permissions` while the chat feature that uses them is hidden — a CWS reviewer
   may question them; consider stripping for the store build.
3. **Stale docs.** `docs/store-listing.md` still contains the old false claims
   ("no backend", "no open ports", "debugger optional") and the full chat-era copy —
   do not paste from it for store submissions; use `docs/store-description-minimal.txt`.
4. **Screenshots.** Existing CWS listing screenshots were NOT reviewed — if any show
   the Chat tab or API-key settings, they must be replaced before submission.

## Operational learnings

- **Extensions cannot script the CWS dev console.** Chrome hard-blocks all extensions
  (content scripts AND `debugger` attach) on `chrome.google.com/webstore/...` —
  "The extensions gallery cannot be scripted". AgentHub MCP tools can `list_tabs` /
  `navigate` that tab but never read or fill it. Listing edits are always manual.
- CWS field sources: Title ← manifest `name`; Summary ← manifest `description`;
  Description ← console text box (the only pasteable field).

## Manual steps remaining (as of session end)

1. Upload the rebuilt zip in the dev console (updates Title + Summary).
2. Paste the description from `docs/store-description-minimal.txt`.
3. Review/replace listing screenshots (flag #4).
4. Resolve the telemetry disclosure gap (flag #1).
5. Final human check, then submit for review.
