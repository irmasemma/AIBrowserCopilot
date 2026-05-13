# Brief: Chrome Web Store Screenshots for "Pilotwave"

> Self-contained handoff brief. Paste verbatim into an LLM (or hand to a designer) — no prior context required.

## Product summary

Pilotwave is a Chrome extension that brings AI into the browser two ways:

1. **AI chat sidebar** — a chat agent lives in Chrome's side panel, uses the user's own OpenAI API key (gpt-4o-mini), and can read/click/type/extract on the active tab via tool calls.
2. **MCP server** — exposes the same tools over the Model Context Protocol so external AI tools (Claude Code, Cursor, VS Code, Windsurf, Continue, JetBrains, Zed) can drive the user's real Chrome.

Differentiators vs. competitors (Sider, Monica, Browser MCP, HARPA):

- Works in the user's **real Chrome** with logged-in sessions (cookies, auth) — no separate Chromium
- **Multi-tab**: every tool takes a tab ID; the agent can extract from Tab A and fill a form in Tab B
- **Auto-reconnect** after Chrome / IDE restart (lock file + service discovery)
- Real-time **activity log** + per-tool toggles + domain blocklist

## Output specs (hard requirements from Chrome Web Store)

| Asset | Quantity | Dimensions | Format | Max size |
|---|---|---|---|---|
| Listing screenshots | 5 (required ≥1, max 5) | **1280 × 800** px (preferred) or 640 × 400 | PNG, JPEG, or 24-bit BMP | 5 MB each |
| Small promo tile (optional) | 1 | **440 × 280** px | PNG or JPEG | n/a |
| Marquee promo (optional, only if featured) | 1 | **1400 × 560** px | PNG or JPEG | n/a |

Deliver 5 listing screenshots. PNG preferred. Filenames: `01-chat-hero.png`, `02-mcp-settings.png`, `03-tools-log.png`, `04-form-fill.png`, `05-multi-tab.png`.

## Visual style

- **Style:** clean product screenshot, NOT a marketing mockup with bold overlay text or stock-photo people. Looks like a real Chrome window.
- **Chrome version:** modern Chrome chrome (omnibox at top, tabs visible, side panel on the right).
- **Color palette:** neutral whites/grays for the chrome and page content; side panel can use a subtle accent (the extension is built with Tailwind on `bg-neutral-50` / `text-neutral-900`).
- **Annotations OK but minimal:** a single short callout label (e.g. "Tab A → Tab B") with a small arrow is fine on screenshot #5. Avoid: marketing headlines slapped on, multiple labels, drop shadows, gradients.
- **Resolution:** crisp, no JPEG artifacts, no fake blur. Real-looking content (use realistic-but-fake names like "Jane Doe", `jane@example.com`, not "John Smith #1").
- **No real user data:** all names, emails, company names must be plausible fake (Acme Corp, Globex Inc, etc.). No real LinkedIn URLs, no real Salesforce orgs.

## Screenshots in order (each tells a chapter of the story)

---

### Screenshot 1 — `01-chat-hero.png` (HERO — most important)

**Dimensions:** 1280 × 800

**Scene:** Chrome window showing a LinkedIn-style profile page on the left ~70% and Pilotwave's side panel on the right ~30%.

**Side panel content (Chat tab active):**

- Header: small "Pilotwave" wordmark + green "Connected" status dot
- Conversation:
  - User bubble: *"Extract every job from this profile into a table"*
  - Assistant bubble in progress: *"Reading the page… calling extract_data…"* with a small spinner icon
  - Tool call indicator card: `extract_data` with arguments like `{ selector: ".experience-section" }`
  - Result preview card: a 3-row table with columns `Company | Role | Dates` and rows like `Acme Corp | Senior PM | 2023–Present`, `Globex | PM | 2020–2023`, `Initech | APM | 2018–2020`
- Footer of chat: text input box with placeholder *"Ask anything about this page…"*

**Left-side page:** plausible-fake LinkedIn-style profile of "Jane Doe — Senior Product Manager at Acme Corp" with an Experience section listing 3-4 fake jobs. No real photos — use a neutral avatar circle.

**Story it tells:** "AI does real things on the page you're already on."

---

### Screenshot 2 — `02-mcp-settings.png`

**Dimensions:** 1280 × 800

**Scene:** Chrome window with side panel open, Settings tab active. Left side shows a neutral page (e.g. Chrome's new-tab page, or a generic dashboard — doesn't matter, this is about the settings).

**Side panel content (Settings tab):**

- Header: "Pilotwave" wordmark + "Connected" status
- Tab strip: `Chat | Tools | Settings` with Settings selected
- Section "MCP Connection":
  - "Status: Connected via native messaging" with a green dot
  - List of detected AI tools with checkmarks: ✓ Claude Code, ✓ Cursor, ✓ VS Code, ✓ Windsurf, (greyed) Continue, (greyed) Zed
  - Below: a small code-style box with the MCP config snippet:
    ```
    {
      "mcpServers": {
        "pilotwave": {
          "command": "%LOCALAPPDATA%/pilotwave/native-host.exe"
        }
      }
    }
    ```
  - Button: "Copy MCP config"
- Section "OpenAI API Key":
  - Password-masked input field showing `sk-•••••••••••••••••••••••••••• abcd`
  - Helper text: "Used only for the chat tab. Stored locally."
- Section "Model": dropdown showing "gpt-4o-mini" (greyed out, single option)

**Story:** "Works with all your AI tools. Bring your own OpenAI key for chat."

---

### Screenshot 3 — `03-tools-log.png`

**Dimensions:** 1280 × 800

**Scene:** Chrome side panel showing the Tools tab. Left side: any neutral content page (doesn't matter).

**Side panel content (Tools tab):**

- Header: "Pilotwave" + "Connected"
- Tab strip with `Tools` selected
- Top half — "Permissions" section with toggle switches (use real iOS-style toggles):
  - ✓ Read page content (ON)
  - ✓ Take screenshots (ON)
  - ✓ List tabs (ON)
  - ✓ Navigate (ON)
  - ✓ Fill forms (ON)
  - ✓ Click elements (ON)
  - ✗ Extract tables (OFF)
  - ✓ Extract structured data (ON)
- Bottom half — "Activity log" with a few timestamped rows in monospace:
  ```
  21:34:12  extract_data    linkedin.com/in/jane-doe        14 rows
  21:34:08  get_page_content linkedin.com/in/jane-doe       4.2 KB
  21:33:51  take_screenshot tab 3                           1280×800
  21:33:42  list_tabs       —                               7 tabs
  21:33:29  navigate        salesforce.com/lightning/r/…    ok
  ```
- Small "Clear log" button bottom-right

**Story:** "You see and control every AI action. Privacy-respecting."

---

### Screenshot 4 — `04-form-fill.png`

**Dimensions:** 1280 × 800

**Scene:** Chrome window with a multi-field form on the left and the chat side panel on the right.

**Left side — the form:** a plausible-fake CRM "Add Contact" or "New Lead" form with fields:

- First name: `Jane`
- Last name: `Doe`
- Email: `jane.doe@acme.example`
- Phone: `+1 (555) 010-4477`
- Company: `Acme Corp` (dropdown with the value selected)
- Title: `Senior Product Manager`
- Lead source: `Website` (dropdown)
- A small subtle highlight ring around the most-recently-filled field (the Title field, for example) to show "the AI just filled this one"

**Right side — chat panel:**

- User bubble: *"Fill this form: Jane Doe, Sr PM at Acme Corp, jane.doe@acme.example, source = website"*
- Assistant bubble: *"Filling 7 fields…"* with a tool call card `fill_form` and a result card `✓ 7 fields filled`

**Story:** "AI fills forms. Real ones, with real dropdowns and validation."

---

### Screenshot 5 — `05-multi-tab.png` (DIFFERENTIATOR)

**Dimensions:** 1280 × 800

**Scene:** Chrome window with **4 visible tabs in the tab strip**, labeled:

- Tab 1: "Salesforce — Lightning" (currently focused, shows a contact record page on the left)
- Tab 2: "Jane Doe | LinkedIn"
- Tab 3: "Acme Corp - Crunchbase"
- Tab 4: "Pilotwave: AI Chat…" (background)

**Left side — Tab 1 content:** A fake Salesforce contact page for "Jane Doe" with empty fields (Email, Phone, Company Notes).

**Right side — chat panel:**

- User bubble: *"Find Jane's email from Tab 2 and her company's funding round from Tab 3. Fill them into the notes field here."*
- Assistant bubble showing a sequence of tool calls in compact cards:
  1. `list_tabs` → 4 tabs found
  2. `get_page_content` (tab 2) → "Found email: jane@acme.example"
  3. `get_page_content` (tab 3) → "Found Series B, $42M, Mar 2024"
  4. `fill_form` (tab 1) → ✓ Notes field updated
- Final assistant message: *"Done. Notes filled."*

**Optional minimal annotation:** small arrow from "Tab 2" to the chat tool-call card with the label "Tab 2 → Tab 1" in light grey text. Use sparingly — one annotation max.

**Story:** "Multi-tab orchestration. Browser MCP can't do this. Monica/Sider can't either."

---

## Anti-patterns — do NOT do any of these

- ❌ Bold marketing overlay text ("BUY NOW", "BEST AI EVER")
- ❌ Stock-photo people in the screenshots
- ❌ Fake reviews / "10M users" badges
- ❌ Screenshots that look obviously mocked up in Figma — these get rejected by CWS reviewers
- ❌ Real user data (real emails, real LinkedIn URLs, real Salesforce orgs)
- ❌ Real API keys visible anywhere (mask with •)
- ❌ Chrome window with the *Pilotwave dev console tab* visible (meta and confusing)
- ❌ Comic Sans, drop shadows, neon gradients
- ❌ Different visual styles between the 5 screenshots — they must look like a set

## What to deliver

5 PNG files at 1280×800, named as listed above. Crisp, neutral, real-looking. The viewer should be able to tell what the product does within 2 seconds of seeing screenshot #1.
