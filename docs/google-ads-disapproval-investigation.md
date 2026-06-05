# Google Ads — "Free desktop software" disapproval

**Status:** Open, not yet diagnosed against the actual ad.
**Campaign:** `Tech.Mom_Us` (campaignId `23620580396`)
**Disapproval reason shown in console:** *Not eligible — Disapproved (Free desktop software)*

## What we know

- The disapproval banner appears on this campaign's ad in the Google Ads console.
- The campaign's account name is `Tech.Mom_Us`. (Same handle as a Threads creator we test against — confirm whether this is an ad targeted to that creator or just an inherited account label.)
- PostCopilot ships a Chrome extension alongside the web tools. Google's "Free desktop software" policy classifies browser extensions, installers, and downloadable utilities under the same umbrella.

## What we did NOT verify

The MCP browser bridge can list the open tabs but currently cannot read into them
(`get_page_content` / `take_screenshot` / `snapshot` all return empty). So as of
this writing **no one has read the actual ad text, headlines, descriptions,
sitelinks, or destination URL.** The analysis below is reasoned from policy
knowledge + project context, NOT from the live ad. Treat as a starting hypothesis
until verified.

## The policy

Google's "Free desktop software" policy (formerly "Unwanted software" — Google
folds them together) auto-disapproves ads that promote:

- Software downloads (installers, executables)
- Browser extensions (Chrome / Edge / Firefox)
- System utilities, cleaners, optimizers
- VPN clients
- Anything that installs to a user's machine

False positives are common — the trigger is often a keyword in the headline /
description, not actual analysis of the destination. Affected accounts are
disproportionately new (low spend history, young domain).

## Most-likely triggers, ranked

1. **Ad copy contains trigger words.** "Free download", "Install extension",
   "Chrome extension", "Add to Chrome", "Get the extension". Any of these in
   headlines, descriptions, or sitelinks is the most common cause.
2. **Final URL points at an install funnel.** `/threads-exporter-extension`,
   a Chrome Web Store URL, or any page whose visible H1 / hero CTA is "Install".
3. **Sitelink extensions point to install pages.**
4. **Landing page screenshots prominently show extension UI** (visual classifier).

## Less likely but possible

5. New domain + new ads account (postcopilot.ai). Younger accounts get policy
   enforcement applied more aggressively.
6. Manual reviewer second-pass flagged the extension after auto-approval.

## Remediation playbook (in priority order)

### Quick wins — no policy fight needed

1. **Pivot the ad to the WEB tool, not the extension.** PostCopilot is a web
   app; the extension is optional. Recast every ad asset:
   - **Headline:** *"Export Threads Followers — No Install"* (lead with the
     differentiator)
   - **Description:** *"Free web tool. Paste a Threads handle, get CSV. No
     extension, no signup."*
   - **Final URL:** `https://postcopilot.ai/threads-follower-export` (web tool,
     not the install funnel)
   - **Avoid words:** Download · Install · Extension · Chrome · Free software
   - **Safe words:** Web tool · Online · Browser-based · Instant · No install

2. **Strip extension references from the landing page** the ad points to. Make
   the web tool the hero; demote the extension to a small sidebar option deep
   in the page or remove from the ad-landing variant entirely.

### Slower but proper fix

3. **Submit Google Ads software verification.** Required to legitimately
   promote downloadable software:
   - Verified business identity
   - Compliance review against the Unwanted Software policy
   - Path: ads.google.com → Tools → Policy Manager → Software verification
   - Turnaround: 3–10 business days, sometimes longer.

4. **Request manual review of this specific ad** once edits are applied.
   Algorithm sometimes reverses on appeal, especially if you can demonstrate
   the destination is a web tool, not an installer.

## To finish the diagnosis

Need ONE of the following:

- Screenshot of the Google Ads disapproval screen (drag into chat — read
  natively, no MCP needed)
- Copy of the ad: headline + description + final URL + any sitelinks, pasted
  as text
- A working MCP bridge that can `get_page_content` on the ad's tab (currently
  returning empty)

With any of the above, we can stop guessing and identify exactly which line of
the ad triggered the classifier.

## Decision log

- **Do NOT recommend** changing PostCopilot's product surface (web tool vs.
  extension priority) to chase Google Ads compliance. The extension is the
  dominant traction signal — 10k events/week. Decisions about extension vs.
  web should be driven by user behavior, not by paid-ads policy.
- **DO** treat the ad creative as a separate artifact from the product. The
  ad can promote the web variant exclusively while the product offers both.
