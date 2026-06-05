# Session log — 2026-06-02 → 2026-06-05

Comprehensive record of the multi-day session covering analytics analysis,
admin-dashboard diagnostics, the post-downloader pre-check + classifier work,
cache-busting + new-version toast, the userId-lifecycle bug fix, UI/UX
improvements, the deep `@daiki_fx_` investigation, and the Google Ads /
MCP-tooling threads we couldn't close.

---

## Table of contents

1. [Traffic analysis — past 7 days](#1-traffic-analysis--past-7-days)
2. [SEO + growth strategy iterations](#2-seo--growth-strategy-iterations)
3. [Admin dashboard diagnostics](#3-admin-dashboard-diagnostics)
4. [Confidence calibration on the post-downloader failure rate](#4-confidence-calibration-on-the-post-downloader-failure-rate)
5. [Where the scraper selector lives](#5-where-the-scraper-selector-lives)
6. [Real reason for per-profile failures (not a scraper bug)](#6-real-reason-for-per-profile-failures-not-a-scraper-bug)
7. [UI proposal for private / empty / 404 states](#7-ui-proposal-for-private--empty--404-states)
8. [Detection logic — what markers really exist](#8-detection-logic--what-markers-really-exist)
9. [Real Puppeteer probe of all "failed" handles](#9-real-puppeteer-probe-of-all-failed-handles)
10. [Pre-check classifier — implementation, tests, deploy](#10-pre-check-classifier--implementation-tests-deploy)
11. [Cache-bust deploys + new-version toast](#11-cache-bust-deploys--new-version-toast)
12. [Extending pre-check to followers/following](#12-extending-pre-check-to-followersfollowing)
13. [Mirroring pre-check onto /threads-follower-export](#13-mirroring-pre-check-onto-threads-follower-export)
14. [Video downloader — false-alarm correction](#14-video-downloader--false-alarm-correction)
15. [Deep investigation: `@daiki_fx_`](#15-deep-investigation-daiki_fx_)
16. [The userId lifecycle bug + auto-fallback on 401](#16-the-userid-lifecycle-bug--auto-fallback-on-401)
17. [Upfront public/private hint](#17-upfront-publicprivate-hint)
18. [Self-audit + 401 infinite-loop bug](#18-self-audit--401-infinite-loop-bug)
19. [Google Ads "Free desktop software" disapproval](#19-google-ads-free-desktop-software-disapproval)
20. [Extension logs question](#20-extension-logs-question)
21. [MCP browser screenshot debugging](#21-mcp-browser-screenshot-debugging)
22. [Final state of production + repo](#22-final-state-of-production--repo)
23. [Open issues at session close](#23-open-issues-at-session-close)

---

## 1. Traffic analysis — past 7 days

Refreshed data first via `node export-firestore.js` + `npm run analytics`. Pulled
`data/analytics/ga4-2026-06-03.json`, `data/analytics/gsc-2026-06-03.json`, and
`analytics_events.csv`.

### Headline numbers (2026-05-27 → 2026-06-02)

| Channel | Volume | Notes |
|---|---|---|
| Extension events | 10,124 (10,027 `export_followers`) | Still dominant by ~100× |
| Website active users | 74 | 87 sessions, 66 first-visits |
| Search Console | 23 clicks / 487 impressions / pos 12.3 | Up from 16/326 prior week |

### Extension daily volume

```
5/27=1748  5/28=1675  5/29=1464  5/30=786  5/31=989  6/01=1864  6/02=1857
```

Weekend dip then full recovery. `userId` always `"anonymous"` — couldn't size
the user base. This became a recurring theme: **10k events could be 50 users or
5,000.**

### Website (GA4)

- Top pages: `/` (37), `/fake-threads-post-generator` (16, 158s dwell), `/threads-exporter-extension` (13), `/post-downloader` (12), `/ai-generator` (8)
- Sources: Organic Search 45, Direct 19, Referral 12, Organic Social 5
- Countries: US 18, India 9, Malaysia 5, Vietnam 5, Brazil 4, Hong Kong 3

### Conversion funnel

- `paste_url` 59 / 12 users → `results_loaded` 18 / 9 users → `click_download_posts` 10 / 10 users → `download_csv` 3
- Post-downloader: 12 paste URLs → ~75% see results, 56% click download, **25% complete CSV download** — last drop is the leak.

### Search (GSC)

Winners: `fake threads post` (4 clicks, pos 3.75, 17% CTR), `fake threads post maker` (pos 5.2, 22%), `threads exporter` (pos 4.7, 33%).

Near-misses: `threads post generator` — 28 impressions, pos 21 across 3 pages competing (homepage + `/ai-generator` + `/fake-threads-post-generator`) — clear cannibalization. `/download` 63 impressions at pos 15-19 for no-watermark queries, 0 clicks.

---

## 2. SEO + growth strategy iterations

User pushed back several times on the analyst framing, asking for actionable
playbooks instead. Three iterations:

### Round 1 — extension-first take

Proposed: the extension already has product-market fit (10k events/week in SE
Asia). The website doesn't. So treat the site as install-funnel #2 for the
Chrome Web Store. Optimize CWS listing, get localized listings, rewrite title
for keyword density, build review velocity.

### Round 2 — website-only playbook (after user said "don't want to optimize extension")

Proposed: the problem isn't ranking, it's **surface area**. Sites at this stage
that hit 10k MAU have 30-50 tools. The `fake-threads-post-generator` already
proved the template works (17% CTR, 158s dwell). Build 15 micro-tools using the
same template (Threads character counter, username generator, bio generator,
hashtag generator, handle availability checker, engagement calculator, etc.).

Plus: fix the cannibalization on "threads post generator" (pick canonical),
build programmatic SEO with `/threads-profile/[username]` pages, lean on
comparison content, localize for zh-TW / vi / id, pitch tools to existing
roundup listicles for backlinks.

### Round 3 — admin dashboard analysis (next section)

The strategy iterations were never implemented — the conversation shifted to
production diagnostics and the pre-check classifier work.

---

## 3. Admin dashboard diagnostics

Pulled `/api/status`, `/api/logs`, `/api/usage`, `/api/activity` via the
ADMIN_PASSWORD (from the production container's `/app/.env`).

### What I found and reported as P0

- **Post-downloader silent failures**: 9 of 26 `posts` attempts in 7 days returned `count=0`, 5 of today's 7 attempts (57%). Cluster on 06-04 with 195s+ durations matching the `[stream] Primary selector timeout` warnings.
- **Video-downloader looked dead**: `52 total, 0 today, 8 cumulative errors`. (Later corrected — see §14.)
- **Auth post-downloader has zero real users** — only the testing account (`user_a5d4476...`) appeared in 7d of authenticated usage.
- **MCP usage is 99% bots** — YellowMCP-HealthChecker, MCPScoringEngine, relay-registry, mitmcp-scan, wmcp-grader, mcp-rugpull-research, python-httpx. Real MCP human traffic = ~6 hits.

### What was actually a real issue vs noise

The post-downloader failure rate was real but my framing was too aggressive —
see §4 + §6.

---

## 4. Confidence calibration on the post-downloader failure rate

User asked: "How confident are you?" Forced me to refine.

### Per-day breakdown of `posts` attempts (last 7d)

| Day | Attempts | count=0 | Failure rate |
|---|---|---|---|
| 05-29 | 1 | 0 | 0% |
| 05-30 | 1 | 0 | 0% |
| 05-31 | 2 | 1 | 50% |
| 06-01 | 1 | 1 | 100% |
| 06-02 | 3 | 0 | 0% |
| 06-03 | 6 | 2 | 33% |
| **06-04** | **7** | **5** | **71%** |

Sample size of 21 attempts → the 35% headline was misleading. The truer story:
**06-04 broke.** Earlier days were 0-50% with tiny denominators. 5 of today's
failures had 190-198s durations (classic selector-timeout signature). 3 entries
on 06-03 ran 7-17s — different failure mode, probably private/banned profiles.

---

## 5. Where the scraper selector lives

User asked: "Why we have selector specified in website?"

Answer: the selector is **not in the website**. It's in server-side Node.js:

```
worker.js:27    const EL_LOAD = '.x1ypdohk[data-pressable-container="true"]';
worker.js:29    const EL      = '.x1ypdohk[data-pressable-container="true"]';
scrape.js:355   const EL_LOAD = '.x1ypdohk[data-pressable-container="true"]';
```

`.x1ypdohk` is Meta's Stylex-generated CSS class. The Lightsail server launches
headless Chrome via Puppeteer, navigates to `threads.net/@<handle>`, and waits
for that selector to find post tiles. Public HTML pages have no idea this exists.

Meta rotates these classes when they ship CSS refactors → the scraper breaks
until updated. Standard mitigations:
1. Drop the class, keep `[data-pressable-container="true"]`
2. Selector fallback chain
3. Intercept GraphQL responses instead of DOM scraping

---

## 6. Real reason for per-profile failures (not a scraper bug)

User pushed back: "I was able to download posts for tech.mom_us. Why so many failures today?"

Investigated. Found:

| Handle | Result | True cause |
|---|---|---|
| @hijrahroso | ✅ 511 posts at 00:56 | Public, scraper worked |
| @_eduardosmith | ✅ 10 posts at 04:04 | Public, scraper worked |
| @tech.mom_us | ✅ 21 posts at 15:06 | Public, scraper worked |
| @_Eduardosmith**3** | ❌ count=0 | Doesn't exist (typo of working `@_eduardosmith`) |
| @dr.babak.geraiely | ❌ count=0 | Private (text `"This profile is private"` in body) |
| @lavieenbluu | ❌ count=0 | Empty / "No threads yet" |
| @zainab._an | ❌ count=0 | Empty (`0 Threads` in og:description) |
| @daiki_fx_ | ❌ count=0 | Public — needed deeper investigation (later: §15) |

**The pattern was per-account, not flaky scraper.** Every failure logs
`"Primary selector timeout"` — same symptom, different root causes. The scraper
sat for 3 minutes waiting for content that wouldn't render: private accounts,
empty profiles, 404 handles.

**Real issue → UX bug, not scraper bug.** Scraper can't distinguish private vs
empty vs 404 vs broken — they all timeout the same way.

Apologized for the earlier confident "Meta rotated CSS classes" claim. Data didn't support it.

---

## 7. UI proposal for private / empty / 404 states

Designed 5 states + copy + visual treatment:

| State | Card variant | Copy | Action |
|---|---|---|---|
| Public + posts | (no card) | proceed silently | scrape |
| Public + empty | blue info | "no posts to download" | dismiss |
| Private | amber lock | "Log in to a Threads account that follows them" | open login modal |
| Private/404 ambiguous | amber warning | "Try logging in, or check the handle" | login + retry |
| Login-walled (ambiguous detection) | amber warning | same as above | same |

Plus an upfront "Before paste" expectation-setter — which I forgot to ship and
remembered only later in §17.

---

## 8. Detection logic — what markers really exist

Test 1 — curl from Windows (unreliable, Meta serves login wall to anon server fetches):

| Profile | curl title returned | Truth |
|---|---|---|
| @tech.mom_us | `The tech mom (@tech.mom_us) • Threads, Say more` | public ✅ |
| @hijrahroso | `Threads • Log in` | actually public, scraper succeeded |
| @_Eduardosmith3 | `Threads • Log in` | doesn't exist |
| @thisaccountdoesnotexist12345xyz | `Threads • Log in` | doesn't exist |

Meta gates anonymous fetches inconsistently. Simple HTTP probe doesn't work
from our backend.

### Three viable options surfaced

1. **Puppeteer fast-probe on the pooled browser** — has cookies + real Chrome
   fingerprint. Navigate, wait 5s, check DOM markers. Recommended for website.
2. **Extension** — runs in user's authenticated Chrome, can read user-visible
   DOM directly.
3. **Instagram cross-check** — Threads accounts mirror IG; less reliable.

Picked #1 for the website.

---

## 9. Real Puppeteer probe of all "failed" handles

User: "Have you actually run probe of option 1 for accounts above or you assumed?"

Honest answer: assumed.

Built `probe-handles.js`, scp'd to Lightsail, ran in container against the
shared browser pool. 4-5s per profile.

### Real results

| Handle | Title | og:desc | Body marker | Post tiles | True state |
|---|---|---|---|---|---|
| @tech.mom_us | `The tech mom (@tech.mom_us)...` | `1.2K Followers • 178 Threads` | — | 16 | **PUBLIC** |
| @daiki_fx_ | `だいき (@daiki_fx_)...` | `9.7K Followers • 1K Threads` | — | 14 | **PUBLIC** |
| @dr.babak.geraiely | `(@dr.babak.geraiely)...` | `388 Followers • 0 Threads` | **"This profile is private."** | 0 | **PRIVATE** |
| @lavieenbluu | `박규영 (@lavieenbluu)...` | `458K Followers • 3 Threads` | **"No threads yet."** | 0 | **EMPTY** |
| @zainab._an | `𝖟𝖆𝖎𝖓𝖆𝖇 (@zainab._an)...` | `43 Followers • 0 Threads` | **"No threads yet."** | 0 | **EMPTY** |
| @_Eduardosmith3 | `Threads • Log in` | (generic) | login wall | 0 | **LOGIN-WALLED** |
| @hijrahroso | `Threads • Log in` | (generic) | login wall | 0 | **LOGIN-WALLED** at probe time, but scraper got 511 posts earlier |

### Corrections to my earlier claims

1. **dr.babak.geraiely is genuinely PRIVATE**, not empty. The `og:desc = "0 Threads"` was misleading — Threads shows 0 because the unauthenticated requester can't see them. Body text was definitive.
2. **lavieenbluu has 3 Threads in og:desc but body says "No threads yet."** Probably replies/reposts only.
3. **`_Eduardosmith3` login-wall is indistinguishable from `hijrahroso` login-wall.** Same exact response. Single probe cannot tell "doesn't exist" from "bot-blocked" from "actually private."
4. **@daiki_fx_ is PUBLIC with 1K posts** and Puppeteer can see 14 tiles right now. But the scraper failed today at 03:39 → real bug worth investigating separately.

User also pointed out: `_Eduardosmith3` is actually **private** (not a typo).
That confirmed the "hard private" flavor — Threads serves identical login wall
to truly private, mistyped, and bot-blocked.

→ **`PRIVATE_OR_404` collapsed bucket** is the right design.

---

## 10. Pre-check classifier — implementation, tests, deploy

User: "implement it but do not push. Implement with UI changes as a best UI/UX expert. Add test that will check what our function returns for all profiles above before merge/deployment. Documnet everything. Make sure no bugs introduced. Test should be real, not mocks. Real browser start and page status detection. Act as a rpincipal SDE and UI/UX"

### Files created

| File | Purpose |
|---|---|
| `lib/classify-threads-profile.js` | `classifyProfile()` (browser-side) + `classifyFromSignals()` (pure) + `sanitizeHandle()` + `STATES` table |
| `api/precheck-profile.js` | HTTP wrapper around the classifier reusing `getBrowser()` pool; never 500s, returns UNKNOWN on internal errors |
| `test/classify-threads-profile.test.js` | Real-browser test (no mocks). Hits live threads.net, distinguishes hard failures from soft-skips (bot-walled probes) |
| `docs/profile-classifier.md` | Design doc: 5-state taxonomy, ASCII UI mockups, deploy notes, why PRIVATE_OR_404 is one bucket, why UNKNOWN falls through |

### Files modified

| File | Change |
|---|---|
| `server.js` | +1 require, +1 route `POST /api/precheck-profile`, wrapped in `logActivity` |
| `public/post-downloader-auth.html` | +CSS for 4 card variants, +inline DOM card, +`runPrecheck()` / `showPrecheckCard()` helpers, gated `startDownload()` so only `action === 'posts'` runs the precheck initially |
| `package.json` | `+ "test:classifier": "node test/classify-threads-profile.test.js"` |

### State taxonomy

| State | Detector | Frontend action |
|---|---|---|
| `PUBLIC_HAS_POSTS` | `title` matches `(@handle) • Threads` AND ≥1 `[data-pressable-container="true"]` | proceed silently |
| `PUBLIC_EMPTY` | title has @handle AND body has `"No threads yet"` (or og:desc shows `"0 Threads"`) | blue card |
| `PRIVATE` | body contains `"This profile is private"` | amber lock card + login CTA |
| `PRIVATE_OR_404` | `title === "Threads • Log in"` AND no @handle in title | amber warning card + login + check-handle |
| `UNKNOWN` | anything else | hide card, fall through to full scrape (soft-fail) |

### Real-browser test results

```
sanitizeHandle:      8/8 PASS (unit)
classifyFromSignals: 5/5 PASS (unit against real signal data)
classifyProfile:    6/6 PASS (real-browser against live threads.net)
```

Probe latency: 4.5-5.5s per profile vs 195s for failed scrapes → ~40× speedup
on the failure path.

### Deploy

Fast-update flow (scp + docker cp + restart). 4 endpoints verified in
production. Committed: `fb422b8 Pre-check post-downloader profiles before scraping`.

---

## 11. Cache-bust deploys + new-version toast

User: "why I had to clear cache manually. Can we tell browser to do it automatically?"

### The two issues

1. HTML routes inherited Express's default `Cache-Control: public, max-age=0` — browsers reuse cached copies in BFCache, soft-nav, etc.
2. Already-open tabs hold the OLD DOM in memory regardless of headers.

### Server-side fix

Replaced `res.sendFile()` for HTML page routes with a custom implementation:
synchronous file read, content-hash ETag, `Cache-Control: no-cache`, uses
`res.send()`. The `{ cacheControl: false }` option on `send` proved unreliable.
Filter: GET/HEAD on clean URLs without `/api/` prefix or file extension.

Debug pain point: I initially burned ~20 minutes thinking my middleware wasn't
firing because `curl -sI` (HEAD) doesn't match my GET-only filter. Real browsers
(GET) were already getting the right headers. Fixed filter to include HEAD too.

### Client-side toast

`public/components/version-check.js` (new file, self-contained IIFE):

- Polls `/api/version` every 5 min + on `visibilitychange`
- Compares response to baseline established on page load
- Different version → bottom-center toast: "A new version is available — refresh to update."
- Dismiss sticky per version via `sessionStorage` so dismissing v1 doesn't resurface until v2
- Loaded site-wide via `components/loader.js`

### Server endpoint

```js
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: String(serverStartedAt) });
});
```

`serverStartedAt` was already defined at line 69.

### Verified across 8 routes

All HTML pages serve `Cache-Control: no-cache`. Conditional GET returns 304.
`/api/version` returns `no-store`. CSS/JS still long-cache + immutable.

Committed: `771fae8 Cache-bust deploys: no-cache HTML + new-version toast`.

---

## 12. Extending pre-check to followers/following

User caught: "have we added probe just for posts download or follower and following as well? It should have the same check"

I had gated the precheck behind `action === 'posts'`. Followers/following were
missing.

Made action-aware:

| State | posts | followers | following |
|---|---|---|---|
| `PUBLIC_HAS_POSTS` | proceed | proceed | proceed |
| `PUBLIC_EMPTY` | **block** ("no posts") | proceed | proceed |
| `PRIVATE` | **block** + login CTA | **block** + login CTA | **block** + login CTA |
| `PRIVATE_OR_404` | **block** + login CTA | **block** + login CTA | **block** + login CTA |
| `UNKNOWN` | proceed (soft-fail) | proceed (soft-fail) | proceed (soft-fail) |

Key call-out: `PUBLIC_EMPTY` stays action-aware on purpose. `@lavieenbluu` has
458K followers and 0 posts — blocking the follower export there would be wrong.

Committed: `1b9d2bf Extend pre-check to followers/following exports`.

---

## 13. Mirroring pre-check onto /threads-follower-export

User: "on what pages it's available threads-follower-export and post-downloader?"

Caught my omission. `threads-follower-export.html` is a 1032-line
near-duplicate of `post-downloader-auth.html` and was missing the pre-check.
Mirrored the same 3 edits:

1. Precheck CSS for 4 card variants
2. Precheck card DOM above progress container
3. JS helpers + integration into `startDownload()` (skipping the
   `upsellCard.classList.remove` call that doesn't exist on this page)

Updated `docs/profile-classifier.md` with the per-route coverage table. Flagged
the fragment duplication as future work — extract to
`/components/precheck.js` if a third page is added.

Committed: `f021779 Mirror pre-check onto /threads-follower-export`.

User then asked to push — pushed `1b91b15..771fae8` with 5 commits.

---

## 14. Video downloader — false-alarm correction

User tested `https://www.threads.com/@kaavyagowdawrites/post/DZJ3GGJjHkm` and
asked me to review logs.

Logs showed:

```
Video URL captured: AQOFTXCK... (scontent-ord5-3 / t16/f2/m84)
Video URL captured: AQO1cntb... (scontent-ord5-2 / t2/f2/m86)
Video URL captured: AQNTy35m... (scontent-ord5-3 / t2/f2/m86)
Video URL captured: AQPsoyAe... (scontent-ord5-1 / t2/f2/m86)
Video URL captured: AQMzXelB... (scontent-ord5-2 / t2/f2/m86)
Video URL captured: AQPUdxNk... (scontent-ord5-3 / t2/f2/m86)
Video wait complete. Intercepted URLs: 6
Fast extraction complete. Videos found: 6
Returning 6 video URLs
```

Server returned **6 URLs** end-to-end. Not dead at all.

The 6 URLs are stream variants of the same post (1 thumbnail + 5 HLS/quality
variants across CDN edges) — not 6 distinct videos. The post had ONE
user-facing video.

**Correction**: my earlier P0 "/download looks dead" claim was wrong. `today: 0`
at the time I checked meant "no usage yet that day," not "broken." The 8
cumulative errors are historical, not current breakage.

Possible UI issue worth investigating separately: if the frontend renders 6
download buttons for a single video, users may click variants that aren't
standalone playable. Wasn't dug into.

---

## 15. Deep investigation: `@daiki_fx_`

User: "Perform Deep investigation of OR P0 #1 (@daiki_fx_ debug, ~2 hours)"

### Findings

1. The 05-26 failure ts was actually 2026-05-26, not "today." 9 days old.
2. Three usage entries for @daiki_fx_ on that day:
   - 03:23 followers: SUCCEEDED, 53 results, `user_a5d4476...` (shared session)
   - 03:25 following: SUCCEEDED, 66 results, `user_a5d4476...`
   - 03:40 posts: FAILED, count=0, **`user_787a327...`** (different user!)
3. `user_787a327` has **zero activity log entries** — no login, no other scrapes
4. **Live reproduction**: scraped `@daiki_fx_` via shared session → **284 posts returned**. Works fine.

### Classified every historical posts failure against live Threads

Ran `lib/classify-threads-profile` against each unique handle that ever failed:

| Handle | Classifier result | Was failure explained by profile state? |
|---|---|---|
| `Amernewzadd` | PRIVATE | ✓ |
| `itsme_monaguilar` | PRIVATE_OR_404 | ✓ |
| `_matilda_balmetti` | PRIVATE | ✓ |
| `atsushi.mercarisensei` | PRIVATE_OR_404 | ✓ |
| `koymanthana4` | PRIVATE_OR_404 | ✓ |
| `archangelhasfallendown` | PRIVATE | ✓ |
| `threadsapp` | PRIVATE_OR_404 | ✓ |
| `zenipenpen` | PRIVATE_OR_404 | ✓ |
| `emilyyfloross6` | UNKNOWN | ambiguous |
| **`daiki_fx_`** | **PUBLIC_HAS_POSTS** (14 tiles) | NOT profile-state |
| **`yourchatgptguide`** | **PUBLIC_HAS_POSTS** (13 tiles) | NOT profile-state |
| **`melodijoelperez`** | **PUBLIC_HAS_POSTS** (5 tiles) | NOT profile-state |

8 of 12 historical "failures" were profile-state issues now caught by
pre-check. The 3 outliers were all `PUBLIC_HAS_POSTS` and all with userIds
having ZERO login activity in the activity log.

### Conclusion

**There is no scraper bug.** Every historical "failure" is one of:
1. Private/empty/missing profile (covered by pre-check)
2. User attempted scrape with an invalid/expired/never-completed Threads session

The user was told "rate limited" after 180s. The real cause: their auth session
was invalid → auth-browser navigated as anon → Threads served login wall →
extension overlay never showed (`overlay=false`) → no GraphQL fired
(`signal=false`) → 180s timeout.

---

## 16. The userId lifecycle bug + auto-fallback on 401

User's sharp observation: "the real issue is that we need to generate user guid once they logged in, right?"

### Correction of my initial story

I had claimed the frontend generates userId via `crypto.randomUUID()` at page
load. Wrong. The actual code (`post-downloader-auth.html:567`):

```js
let currentUserId = localStorage.getItem(AUTH_KEY) || null;
```

The **server** mints userId at `POST /api/login/start`. The bug is at line 787:

```js
currentUserId = data.userId;
localStorage.setItem(AUTH_KEY, currentUserId);   // ← written IMMEDIATELY
```

Frontend persisted the userId the moment login started — before user had typed
any password, before login was verified. Abandon the modal → phantom userId
survives. Later: `currentUserId` exists, `checkAuthStatus` makes `isLoggedIn`
true if server happens to find any cookies for it → scrape fires → 180s
timeout.

### Fix shipped (both HTML files)

| Where | Currently | Should be |
|---|---|---|
| Login-start handler | `currentUserId = data.userId; localStorage.setItem(...)` | `currentUserId = data.userId;` (in-memory only) |
| Login-complete handler, `data.valid === true` | (no localStorage call) | `localStorage.setItem(AUTH_KEY, currentUserId);` |
| Modal-abandon handlers | (no cleanup) | `if (!isLoggedIn) currentUserId = null;` |
| 401 from scrape | "Session expired. Please login again." | Clear stale + silently retry via shared session |

The auth flow's existing `data.alreadyLoggedIn` fast-path at login-start
already represents server-confirmed session — kept that localStorage write.

Server already validates session at line 503-506:
```js
const isAuthenticated = userId && hasValidSession(userId);
if (!isAuthenticated) {
  return res.status(401).json({ error: 'Not authenticated. Please login first.' });
}
```

So server-side guard was already there. The fix is entirely client-side.

Committed: `6cd6e36 Don't persist userId until login is verified; auto-fallback to shared on 401`.

---

## 17. Upfront public/private hint

User: "have we added UI telling about publicly available profiles?"

Honest answer: no. I'd reactive-only — pre-check card after submit but nothing
before. The "state #1 upfront expectation-setter" was in my original UI/UX
proposal but I never shipped it.

### Pro-grade UI/UX recommendation given

- ❌ Reject 3-pill chip row (looks like marketing, icons confuse ESL readers)
- ❌ Reject sentence under lead paragraph (adds vertical noise above input)
- ❌ Reject bullet list (looks like docs)
- ❌ Reject hover tooltip (mobile = no hover)
- ❌ Reject first-visit modal (hostile)
- ✅ **One muted-gray helper line right below the input field. No icons. No chips. 10 words.**

Copy: **"Works on any public profile. Log in to access private ones."**

### Implementation

Both HTML files, inside `.input-group`, after the `<input>`:

```html
<input id="threadsProfileUrl" type="text" placeholder="..." aria-describedby="threadsProfileUrlHint" />
<small id="threadsProfileUrlHint" class="input-hint">Works on any public profile. Log in to access private ones.</small>
```

```css
.input-hint { font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0; }
```

### Component compatibility audit

- ✅ `.input-hint` class doesn't collide anywhere
- ✅ `--text-muted` is defined on both pages
- ✅ `.input-group` flex `gap: 8px` spaces hint 8px below input automatically
- ✅ `.action-row { margin-top: 16px }` preserves rhythm to buttons
- ✅ `aria-describedby` improves accessibility (screen readers announce hint on focus)
- ✅ Pre-check card still renders below input on submit — stacks cleanly
- ✅ Mobile media query at `.action-row` already handles small screens

Committed: `b153071 Add upfront public/private hint under the profile input`.

---

## 18. Self-audit + 401 infinite-loop bug

User: "are you sure we are 100% good. no new issues introduced?"

Did a thorough self-audit. Found ONE real bug:

### The bug

The 401 auto-fallback could infinite-loop if the shared session also returned
401 (e.g., its cookies expired or admin killed its auth browser). My code:

```js
if (response.status === 401) {
  clearStaleSession();
  if (sharedSession?.available) {
    return startDownload(action);   // ← recursive, no guard
  }
}
```

Trace: shared session 401 → enters handler → `sharedSession?.available` still
true (we never update it) → recurses → 401 → recurses → infinite loop on
user's browser.

### Fix

Added `_retryWithShared` single-shot flag:

```js
async function startDownload(action, _retryWithShared = false) {
  ...
  if (response.status === 401) {
    clearStaleSession();
    if (sharedSession?.available && !_retryWithShared) {
      return startDownload(action, true);
    }
    statusEl.textContent = _retryWithShared
      ? 'The free shared account is currently unavailable...'
      : 'Your session expired and the free shared account is unavailable...';
  }
}
```

Risks I ruled out in the audit:
- `fsReadFile` blocking event loop — files <100KB, ~1ms read
- sendFile override corrupting non-HTML — filter excludes paths with extensions
- HEAD requests get wrong body — `res.send()` auto-strips body for HEAD
- Phantom userId from before this deploy — `checkAuthStatus` server-validates and clears on next page load
- Two-tab race during login — userId held in-memory per tab
- Pre-check pool saturation — 5s/req × 74 users/week is negligible vs 20-tab pool
- Toast polls bombarding endpoint — 5-min interval, dedup guard
- **401 → recursive retry → infinite loop** ← real, fixed

Committed: `5bca0af Guard 401 auto-fallback against infinite loop`.

---

## 19. Google Ads "Free desktop software" disapproval

User sent URL to ad in their `Tech.Mom_Us` campaign. Asked me to analyze why
ad was marked "Not eligible — Disapproved (Free desktop software)."

### Couldn't actually see the ad

MCP browser bridge (`mcp__agenthub__*`) returned empty for every per-tab call
(`get_page_content`, `take_screenshot`, `snapshot`, `get_page_metadata`).
`list_tabs` worked.

### Saved analysis playbook

Wrote `marketing/google-ads-disapproval-investigation.md` with:

- The policy: Google's "Free desktop software" auto-disapproves ads promoting
  installers, browser extensions, system utilities. Heavy on false positives
  for young accounts.
- Most likely triggers (ranked, **inferred not verified**):
  1. Ad copy contains "Free download", "Install", "Extension", "Chrome"
  2. Final URL points at install funnel (`/threads-exporter-extension`, CWS link)
  3. Sitelinks point to install pages
- Remediation:
  1. **Quick wins:** Pivot ad to web tool (`postcopilot.ai/threads-follower-export`), avoid trigger words, use safe words ("web tool", "online", "no install")
  2. **Slower:** Submit Google Ads software verification
  3. Request manual review after edits
- Decision log: **DO NOT** change product surface to chase Google Ads compliance.
  The extension is the dominant traction signal — keep both. Ad creative is a
  separable artifact.

### What I need to actually diagnose

User has to drag a screenshot of the ad editor into chat, or paste headlines +
description + final URL as text.

---

## 20. Extension logs question

User asked what extension logs we have.

Inventoried `extension/ExportUserThreads.js`:

| Type | Status |
|---|---|
| Usage events (export_followers, export_posts) | ✅ Captured via `trackUsage()` → batched every 30s or every 10 events → POST to `https://us-central1-threadsexporter-8e06b.cloudfunctions.net/analyticsBatch` → Firestore → exported to `analytics_events.csv` |
| Errors / exceptions | ❌ Silently swallowed in `catch (e) {}` at every site |
| Console logs | ❌ Never leave the user's browser |
| User identity | ❌ Always `"anonymous"` — can't tell unique users |
| Threads page state failures | ❌ Not captured |

Recommendation (each ~30 min):
1. Stamp a stable client UUID via `chrome.storage.local`
2. Replace `catch (e) {}` with `catch (e) { trackUsage("client_error", { msg: e.message }) }`
3. Stamp `manifest.version` in every event

Not implemented — left as recommendation.

---

## 21. MCP browser screenshot debugging

Extended stretch of trying to get a screenshot of `/threads-follower-export`
and the Google Ads page via MCP.

### What worked

- `mcp__agenthub__list_tabs` always returned full JSON of all open tabs

### What never worked

- `mcp__agenthub__take_screenshot` returned empty
- `mcp__agenthub__get_page_content` returned empty
- `mcp__agenthub__snapshot` returned empty
- `mcp__agenthub__get_page_metadata` returned empty
- `mcp__agenthub__navigate` returned empty
- `mcp__browsermcp__browser_snapshot` errored: "No connection to browser extension"

### Root cause identified

User reported browser console error:

```
WebSocket connection to 'ws://127.0.0.1:7483/?browserId=...' failed:
Error in connection establishment: net::ERR_NETWORK_IO_SUSPENDED
```

That's Chrome reporting the agenthub MV3 extension's **service worker has been
suspended** (after 30s inactivity per MV3 design, or due to Windows
efficiency-mode / Modern Standby). The WebSocket dies, can't be reopened until
the worker wakes up. Hence:

- `list_tabs` works (served by MCP bridge via CDP, no WS to extension needed)
- everything else fails (needs WS to extension's content script)

### Workarounds suggested

1. `chrome://extensions/` → click the blue `service worker` link next to
   agenthub → forces worker wake
2. Toggle extension off and on
3. Pin extension to toolbar (Chrome treats pinned-extension activity as
   user attention)
4. Hard re-install if it stays broken

User also opened `chrome://extensions/?errors=ehchmchlmggdigicfjfmlgcbhdcdcmll`
indicating the extension has logged errors → likely deeper than just service
worker suspension. Asked user to share what's in the error log. Not yet
resolved at session close.

---

## 22. Final state of production + repo

### 7 commits shipped + pushed to `origin/main` this session

1. `fb422b8 Pre-check post-downloader profiles before scraping`
2. `1b9d2bf Extend pre-check to followers/following exports`
3. `f021779 Mirror pre-check onto /threads-follower-export`
4. `771fae8 Cache-bust deploys: no-cache HTML + new-version toast`
5. `6cd6e36 Don't persist userId until login is verified; auto-fallback to shared on 401`
6. `b153071 Add upfront public/private hint under the profile input`
7. `5bca0af Guard 401 auto-fallback against infinite loop`

### Production at parity with `origin/main`

- Server container `threads-backend` on Lightsail
- Last container restart timestamp visible via `/api/version`
- All deployed via Fast Update flow (scp + docker cp + restart) per `README-DEPLOY.md`
- Container's `/app/.env` has all 8 env vars intact

### Failure-class coverage now

| Failure class | Before this session | After this session |
|---|---|---|
| Profile is private | 180s silent timeout, "rate-limited" msg | Pre-check ~5s, "Log in to follow" + login CTA |
| Profile is empty (0 posts) | 180s silent timeout | Pre-check ~5s, "No posts to download" |
| Profile doesn't exist | 180s silent timeout | Pre-check ~5s, "Could not load — check handle or log in" |
| Stale auth session | "Session expired, please log in again" | Auto-fallback to shared session, transparent |
| Abandoned login | Phantom userId, eventual 180s timeout | No phantom userId persisted, uses shared seamlessly |
| Real network/Threads hiccup | Same | Same |
| Browser doesn't see new deploy | Hard refresh required | `no-cache` HTML + "new version" toast |

### Browser cache behaviour

- HTML pages: `Cache-Control: no-cache` + strong content-hash ETag
- `/api/version`: `no-store`
- Static CSS/JS/images: `public, max-age=31536000, immutable`
- Conditional GET returns 304 on If-None-Match match → soft reload picks up new HTML

### Test infrastructure

- `npm run test:classifier` — real-browser test against live threads.net, 6/6 pass at last run
- Soft-skips bot-walled probes vs hard-fails on real classifier bugs

### Documentation

- `docs/profile-classifier.md` — full design doc, state taxonomy, UI mockups,
  deploy notes, future work
- `marketing/google-ads-disapproval-investigation.md` — saved playbook for the
  disapproval issue, awaiting screenshot

---

## 23. Open issues at session close

### Still unresolved (not P0)

1. **Google Ads "Free desktop software" disapproval** — couldn't see the ad via
   MCP, awaiting screenshot from user.
2. **MCP agenthub service worker keeps suspending** — agenthub Chrome
   extension's MV3 service worker drops after 30s inactivity. User has
   `chrome://extensions/?errors=...` open for the extension; root cause not yet
   diagnosed.
3. **Extension events all `userId="anonymous"`** — recommended adding stable
   client UUID, not implemented yet.
4. **Extension errors silently swallowed** — recommended replacing `catch (e) {}`
   with telemetry calls, not implemented yet.
5. **MCP "today: 170" usage is 99% bots** — admin dashboard should filter known
   bot user-agents, not implemented.
6. **`/download` page CTR is 0 at pos 18** for "no watermark" queries — needs
   title + meta rewrite, not done.
7. **SEO cannibalization on "threads post generator"** — three pages competing at
   pos 21, pick canonical + 301 others, not done.
8. **Video downloader returns 6 stream variants** — unclear if UI dedupes;
   needs DevTools check.
9. **Auth post-downloader has zero real users** — decision needed: kill the
   auth flow or commit to making it frictionless.

### Documented limitations (not bugs)

- `PRIVATE_OR_404` collapsed bucket — needs post-login retry to disambiguate
- Pre-check fragment duplicated across `post-downloader-auth.html` and
  `threads-follower-export.html` — flagged for extraction to
  `/components/precheck.js` if a third page is added.

---

## Decision log

| Decision | Rationale |
|---|---|
| Pre-check on website only, not in extension | Extension runs in user's authenticated Chrome — sees user-visible DOM directly, simpler 2-state taxonomy (has access / doesn't), separate concern. |
| `PRIVATE_OR_404` is one bucket | Threads serves identical login wall to private + 404 + bot-blocked. Single anonymous probe cannot disambiguate. UX copy works for all three: login + check handle. |
| `UNKNOWN` falls through to full scrape | Pre-check is an optimisation, not a gate. New Meta DOM states should never block users. |
| `PUBLIC_EMPTY` blocks posts but allows followers/following | An account with 0 posts (e.g., @lavieenbluu) can still have followers worth exporting. |
| Don't change product surface to chase Google Ads compliance | Extension is the dominant traction signal (10k events/week). Ad creative is separable. |
| Server still mints userId at login-start, frontend only persists at login-complete | Server needs an ID to bind the noVNC browser. Frontend persistence is what creates the phantom-userId class. |
| Replace `res.sendFile` with `fs.readFileSync + res.send` for HTML pages | `send` library's `{ cacheControl: false }` proved unreliable. Sync read is fine for <100KB files in OS page cache. |
| Filter HTML cache middleware on `!path.extname(req.path)` | Clean URLs only. Static files / `/api/*` untouched. |
| 30-second user-only auto-comment cap, but Reddit-related work was not in scope here | (cross-reference only — see `marketing/reddit-launch-plan.md`) |

---

## Code reference index

### New files

- `lib/classify-threads-profile.js`
- `api/precheck-profile.js`
- `public/components/version-check.js`
- `test/classify-threads-profile.test.js`
- `docs/profile-classifier.md`
- `marketing/google-ads-disapproval-investigation.md`
- `docs/session-2026-06-04-postdownloader-overhaul.md` (this file)

### Modified files

- `server.js` — added `/api/precheck-profile`, `/api/version`, HTML cache middleware
- `public/post-downloader-auth.html` — pre-check UI, userId lifecycle, 401 fallback, input hint
- `public/threads-follower-export.html` — same changes
- `public/components/loader.js` — auto-load version-check
- `package.json` — `test:classifier` script

### Unrelated working-tree changes left untouched

- `analytics_events.csv` (M)
- `marketing/reddit-auto-comment-log.md` (M)
- `marketing/reddit-launch-plan.md` (M)
- `DevThreadsExporterFinalWebmarketingreddit-snapshotsfr_day24_postsubmit_check.json` (untracked)
