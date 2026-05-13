# Store screenshots

5 PNG files at 1280×800 for the Chrome Web Store listing, rendered from inline HTML mockups via Playwright. Source spec: `docs/screenshots-brief.md`.

## Files

- `out/01-chat-hero.png` — LinkedIn profile + AgentHub chat extracting jobs into a table. Hero shot.
- `out/02-mcp-settings.png` — Settings tab. MCP connection status, detected AI tools, OpenAI key, model.
- `out/03-tools-log.png` — Tools tab. Per-tool permission toggles + dark activity log.
- `out/04-form-fill.png` — Salesforce-style "New Lead" form filled by the chat agent.
- `out/05-multi-tab.png` — Multi-tab orchestration. Chat reads from Tab 2 + Tab 3, writes into Tab 1.

## Regenerating

```
cd packages/extension/store-screenshots
node generate.mjs
```

Requires `@playwright/test` (already installed at the repo root via the e2e test deps). Output overwrites `out/*.png`.

## Caveats

These are HTML-rendered mockups, not screenshots of the actual extension in real Chrome. They look like Chrome screenshots but a careful reviewer might notice the Chrome shell is simulated. For a polished CWS submission consider a designer pass — or replace this with a real-Chrome-via-Playwright capture pipeline (more involved: requires staging chat transcripts, real OpenAI key, real bridge running).

Content uses plausible-fake names (Jane Doe, Acme Corp, Globex Inc, Initech LLC) per the brief — no real user data, no real API keys.
