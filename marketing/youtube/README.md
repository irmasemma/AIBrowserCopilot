# AgentHub — YouTube / video marketing

Single source of truth for AgentHub demo videos: what we shot, the edited cuts, the titles/descriptions/tags,
the thumbnails, and what's been uploaded. **If asked to modify, re-upload, or script a new AgentHub demo,
start here.** (Full method for producing these lives in the `demo-video-recorder` agent + the
`ThreadsExporterFinal/marketing/demo-harness/` kit — see "How these were made" below.)

Channel: **Investor's Playbook** (@InvestorsPlaybook) — the channel used in the demo footage.
Product: AgentHub — Chrome extension that exposes your browser as MCP tools. Setup: `npx agenthub-setup@latest`.
Store listing copy lives in `docs/store-listing.md` / `docs/store-description.txt`.

---

## 📤 Uploaded videos log  (complete — 4 uploads on 2026-07-11, all by Claude via AgentHub MCP)

| # | YouTube URL | Title used | Package / cut | Thumbnail | Channel | Visibility (as left) |
|---|---|---|---|---|---|---|
| 1 | https://youtu.be/5FVmO1NCHFM | Browser MCP: Give Your AI Your Real Browser | A · how-it-works 65s (raw `Video Project 17-2.mp4`, 1:31) | ❌ none — channel not phone-verified, YouTube blocked custom thumbnails | Easy Investments u4u (`UCUvmPyWesx1BRrtF3qwJqcg`) | Private |
| 2 | https://youtu.be/QObp3xRwgyI | **Browser MCP: Give Your AI Your Real Browser** | A · same cut | `thumbnails/your-ai-your-browser-1280x720.png` | Investor's Playbook (`UC50PcY5yv-u-sR9bDqu18LQ`) | Private → user published (seen Public 2026-07-11) |
| 3 | https://youtu.be/VR1afdXsvEY | I Let Claude Upload This Video to YouTube (Hands-Free) | B · **un-edited** raw take (`UpladVideoYoutubeAgentHubDemo.mp4`, 1:37) | `thumbnails/claude-uploaded-this-1280x720.png` | Investor's Playbook | Private — superseded by #4; candidate for deletion |
| 4 | https://youtu.be/H_05gypRGlY | I Let Claude Upload This Video to YouTube (Hands-Free) | B · **edited** cut = `videos/claude-uploads-to-youtube-84s.mp4` (1:25) | `thumbnails/claude-uploaded-this-1280x720.png` | Investor's Playbook | Private — **the one to publish** |

Applied on every upload: `{{CHROME_STORE_URL}}` filled with the real listing URL
`https://chromewebstore.google.com/detail/mfpojhnbladbbjmcmjglbakfndejkhda` (derived from the CWS devconsole;
verify once the listing is live), full tag set entered as chips (channel-default `#InvestorsPlaybook`/`#Stocks`…
tags cleared first), audience = not made for kids, saved **Private** (upload flow on this channel pre-arms
Public/Publish — always flip to Private unless told to publish).

> Housekeeping: #3 duplicates #4 (same title + thumbnail, older cut) — delete or keep as backup.
> #1 has no thumbnail until that channel completes phone verification (youtube.com/verify), which also makes description links clickable.

---

## 🎬 Edited demo cuts (deliverables, in `videos/`)
| File | Length | What it shows | Source raw (Downloads) |
|---|---|---|---|
| `videos/agenthub-how-it-works-65s.mp4` | 0:65 | General "how it works" tour: setup + the AI reading tabs, filling forms, clicking, extracting data; privacy; CTA. | `C:\Users\semma\Downloads\AgentHubDemo.mp4` (4K, 4:45, 188 MB) |
| `videos/claude-uploads-to-youtube-84s.mp4` | 1:24 | The meta demo: Claude autonomously uploads a video to YouTube — opens Studio, uploads the file (via the file-dialog workaround), types title + full description, sets the thumbnail + 14 tags, runs checks, hits Publish. | `C:\Users\semma\Downloads\UpladVideoYoutubeAgentHubDemo.mp4` (4K, 1:37, 77 MB) |

Raw 4K originals are NOT in the repo (too large) — they live in `C:\Users\semma\Downloads\` at the paths above.
Both edited cuts: 1080p, silent, burned-in subtitles, ClipChamp banner cropped, hook + CTA cards.

---

## 📝 Metadata packages
- **Package A — hero / general** ("Browser MCP: Give Your AI Your Real Browser") → `metadata-01-browser-mcp-hero.md`, thumbnail `thumbnails/your-ai-your-browser-1280x720.png`.
- **Package B — the upload demo** ("I Let Claude Upload This Video to YouTube") → `metadata-02-claude-uploads-to-youtube.md`, thumbnail `thumbnails/claude-uploaded-this-1280x720.png` (+ `.jpg`).

Both were written by the `seo-specialist` agent. Descriptions contain a `{{CHROME_STORE_URL}}` placeholder — fill the real Chrome Web Store URL before publishing.

---

## 🖼️ Assets
- `thumbnails/` — 1280×720, 24-bit: `claude-uploaded-this` (recommended for the upload demo), `your-ai-your-browser` (hero).
- `store-screenshots/` — 5 × **1280×800, 24-bit, no alpha** Chrome Web Store screenshots (real product framed with headlines).
- `screenshots/` — 5 raw product captures (full workspace, tools+activity log, Claude fills composer, connected/setup, localhost dashboard) — source material for thumbnails/store shots.

---

## 🔧 How these were made / how to make more
- **Editing (subtitles, highlights, framing, cards):** the `demo-video-recorder` agent (its charter is at `ThreadsExporterFinalWeb/.claude/agents/demo-video-recorder.md`, also user-level). Runnable harness (ffmpeg/PS scripts + gradient/mask/shadow assets): `ThreadsExporterFinal/marketing/demo-harness/` with a command-by-command `README.md`. Pipeline: crop out the ClipChamp banner → 1080p → mild speed-up → burn subtitles (drawtext) → hook/CTA cards → concat. Silent source → I write the caption copy.
- **Titles / descriptions / tags / thumbnail direction:** the `seo-specialist` agent (repo `ThreadsExporterFinalWeb/.claude/agents/`). It front-loads keywords ("Browser MCP") and leans the hook into the demo's story.
- **The upload itself (Claude → YouTube):** done live by Claude Code driving the real browser through AgentHub's MCP tools (navigate → open YouTube Studio → upload → fill title/description → set thumbnail + tags → Publish). **File-picker gotcha:** AgentHub `fill_form type:file` ENOENTs (playwright-crx virtual fs) — drive the native Open dialog with a SendKeys watcher (see the `agenthub-file-upload-workaround` memory).

## ▶️ Next-time playbook
- **"Modify the video"** → edit source in `C:\Users\semma\Downloads\<raw>.mp4`, re-run the demo-video-recorder pipeline, overwrite the file in `videos/`.
- **"Change the title/description/tags"** → edit the relevant `metadata-0X-*.md`; if the video is already live, have Claude open YouTube Studio → the video → Details and update it via AgentHub.
- **"Upload it"** → have Claude drive YouTube Studio via AgentHub using the chosen `metadata-0X-*.md` + `thumbnails/...` (remember the file-picker SendKeys workaround). Then record the URL in the Uploaded videos log above.
- **"Create a script for AgentHub"** → the demo storyline that works: ask Claude one line ("upload this video to YouTube with a title and description") and it does the whole Studio flow — that's the hero use case.
