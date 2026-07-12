# Session 2026-07-11 — Claude uploads the AgentHub demos to YouTube via AgentHub MCP

Claude Code drove the real logged-in Chrome through AgentHub's MCP tools and performed four complete
YouTube Studio uploads end-to-end — which is itself the product's hero use case (and the literal subject
of demo video "Package B"). This doc records what was done, what worked, and what broke.

**Result:** 4 videos uploaded with title + full description + tags (+ thumbnail where the channel allowed
it), each saved **Private**. URLs, packages, and channels: see the uploaded-videos log in
[`marketing/youtube/README.md`](../marketing/youtube/README.md) — that table is the source of truth.

## The flow that works (repeatable recipe)

1. `list_tabs` → find the YouTube Studio tab; `navigate` to
   `https://studio.youtube.com/channel/<ID>/videos/upload?d=ud` (opens the upload dialog directly).
2. **File picking** — `fill_form type:file` is broken (see
   [findings-2026-07-11-fill-form-file-upload-enoent.md](findings-2026-07-11-fill-form-file-upload-enoent.md)).
   Instead: arm a background PowerShell SendKeys watcher for the native `"Open"` dialog, then
   `click_element` on "Select files". Same trick for the thumbnail's "Upload file".
3. `fill_form` the title + description textboxes by snapshot ref — works fine, including multi-paragraph
   text with emoji and URLs.
4. **Tags:** the paper-chip input takes the whole comma-separated string via `fill_form`, but it sits as
   raw text — chips only materialize after `press_key Enter` on the field. Verify chips in the next
   snapshot. Channel-default tags may be pre-filled — `Delete all` first when they don't fit the video.
5. Audience radio ("No, it's not made for kids") + `Show advanced settings` for tags — snapshot radio
   labels are empty; the click result's element text confirms which one was hit.
6. Next ×3 → Visibility. **Gotcha:** on a channel with defaults, Public may arrive pre-selected with the
   button already reading "Publish" — select Private explicitly (button flips to "Save") unless publishing
   was requested.
7. Screenshot the channel list to verify the row (title, thumbnail, Private).

## Gotchas hit this session

- **`fill_form type:file` ENOENT** — playwright-crx virtual fs; the headline finding (doc above).
- **Custom thumbnails need phone verification** — on the unverified channel (`UCUvmPyWesx1BRrtF3qwJqcg`),
  clicking thumbnail "Upload file" opened a Verify/Cancel dialog instead of a file picker (upload #1 has
  no custom thumbnail until the channel verifies at youtube.com/verify). Kill the armed SendKeys watcher
  when this happens. The verified channel (`UC50PcY5yv-u-sR9bDqu18LQ`) accepted thumbnails without fuss.
- **Bridge restart kills the MCP session** — the bridge exe restarted mid-work (new PID); tools dropped and
  the client had to reconnect (`/mcp` → reconnect agenthub). Browser IDs in tab_ids change across bridge
  restarts (`chrome:<uuid>` rotates) — always re-`list_tabs` after a reconnect.
- **`read_form` threw** `Value is unserializable` (scripting.executeScript args) on the Studio upload
  dialog — worked around with `get_page_content` + snapshots. Possibly worth its own look.
- **Snapshot refs go stale across dialog state changes** — frequent `refIdentityWarning`s; the click still
  landed correctly each time (the warning + returned element text was enough to confirm). Re-snapshot after
  every dialog transition.

## Product takeaways

- The end-to-end story ("one ask → Claude does the whole Studio upload") holds up — 4/4 uploads succeeded,
  including 80 MB 4K files (transfer + processing ran while metadata was being filled).
- Biggest UX gap for agent-driven uploads is the file picker (fix proposal in the findings doc).
- Misc: `CLICK_NOT_ACTIONABLE` as the errorCode for a fs error is misleading; empty radio/tab labels in
  snapshots make Studio's kids-radio and visibility-radio selection blind (had to rely on click-result text).
