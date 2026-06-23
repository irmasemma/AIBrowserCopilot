---
name: Speed, brevity, and quality preferences
description: User prefers fast iteration, approves quickly, wants working code over planning. Insists on real tests. Switch tools fast when something breaks.
type: feedback
---

User approves specs and steps quickly (usually just "C" or "yes"). When given option to do step-by-step vs accelerated, chose step-by-step for planning but wants speed for implementation.

**Why:** Income is the primary motivation. The competitive window is 6-12 months. Every hour spent planning is an hour not shipping.

**How to apply:** Lead with recommendations, don't ask unnecessary questions. When implementing multiple related stories, batch them together rather than one-at-a-time ceremony. Skip party mode and advanced elicitation unless the user explicitly requests them.

**Testing (2026-03-29):** User called out that initial tests were "fake" — they only tested rendering, not real functionality. User wants comprehensive tests in a real browser with real DOM interaction. No mocking.

**How to apply:** Always write tests that verify real behavior. Use Playwright with real Chrome. Test content scripts, DOM manipulation, storage. Run tests and fix failures before presenting results.

**Build tools (2026-03-29):** CRXJS caused MIME type errors in Chrome extension popups. Multiple fix attempts failed. User got frustrated with trial-and-error. Migrated to WXT which worked.

**How to apply:** When a build tool causes issues, don't keep patching — switch tools quickly. WXT is the correct choice for Chrome extensions with Preact in 2026. CRXJS has known issues with Vite 6 + MV3.

**Don't stop fixing (2026-03-29):** User said "why you stopped fixing?" when I paused after a test failure. Keep going until things work — don't present partial results or stop for confirmation mid-fix.
