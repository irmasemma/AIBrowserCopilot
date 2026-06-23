# @agenthub/log-ingest

A tiny Vercel serverless app that receives **opt-in** remote logs from the
AgentHub native host and stores them in **Neon Postgres** so you can
troubleshoot field issues with SQL.

```
native host / extension
   └─ batched, redacted, fire-and-forget POST ─→ /api/logs  (checks x-ingest-key)
                                                    └─ INSERT into Neon (logs table)
   you query with SQL  ←───────────────────────────┘
   /api/prune (Vercel Cron, nightly) ─→ DELETE rows older than RETENTION_DAYS
```

This is a **separate Vercel project** from the extension/native-host. Deploy it
on its own and point a separate Neon project at it (don't co-mingle log volume
with your production app data).

---

## One-time setup

### 1. Create a dedicated Neon project

In the Neon console (or via the Vercel ➜ Neon integration), create a **new
project** just for logs. Copy its connection string (`DATABASE_URL`,
the pooled `...-pooler...` one).

> Use a *separate* project, not a new branch of an existing app — log volume is
> unpredictable and you don't want it eating a production project's free-tier
> storage.

### 2. Create the table

Run `schema.sql` against the new database — Neon SQL Editor (paste it in), or:

```bash
psql "postgresql://...your-neon-url..." -f schema.sql
```

### 3. Deploy to Vercel

From the repo root, point Vercel at this subfolder:

- **New Project** → import the repo
- **Root Directory** → `packages/log-ingest`
- Framework preset: **Other** (it's just `api/` functions)

Or via CLI:

```bash
cd packages/log-ingest
npx vercel        # link/deploy (set root dir when prompted)
npx vercel --prod
```

### 4. Set environment variables (Vercel ➜ Project ➜ Settings ➜ Environment Variables)

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | from step 1 |
| `INGEST_KEY` | a long random string | the client must send this; rotate to revoke |
| `CRON_SECRET` | a long random string | protects `/api/prune`; Vercel sends it automatically |
| `RETENTION_DAYS` | `14` (optional) | how long to keep logs |

Generate the secrets however you like, e.g.:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Redeploy after setting envs so they take effect. The nightly prune cron
(`vercel.json`) runs at 04:00 UTC.

---

## Turn on the client (the native host)

Remote shipping is **off by default**. To enable it on a machine, create/edit
`logs-config.json` in the AgentHub install dir:

- Windows: `%LOCALAPPDATA%\agenthub\logs-config.json`
- macOS: `~/Library/Application Support/agenthub/logs-config.json`
- Linux: `~/.local/share/agenthub/logs-config.json`

```json
{
  "enabled": true,
  "remote": {
    "enabled": true,
    "endpoint": "https://YOUR-APP.vercel.app/api/logs",
    "apiKey": "the-INGEST_KEY-you-set",
    "flushIntervalMs": 5000,
    "maxBatch": 50,
    "maxBufferRecords": 1000
  }
}
```

Restart the bridge (the native host) to pick it up. Records are batched, sent
fire-and-forget, and **already redacted** by the same pipeline that writes the
local `logs\*.log` files. Setting `"enabled": false` (the master switch) turns
off local *and* remote logging.

> **Privacy:** because this ships logs off the user's machine, keep it opt-in
> for real end users (a UI toggle that writes this file), and keep redaction on.
> For your own test machines, just drop the file in.

---

## Querying

See the comment block at the bottom of `schema.sql` for ready-made queries:
last 100 problems, the full call chain for one `mcpId`, daily error rate, etc.
The `fields` jsonb column holds the complete record, so any correlation id from
`docs/structured-logging.md` is queryable, e.g. `fields->>'browserBoundId'`.

---

## What this intentionally does NOT do (yet)

- **Per-IP rate limiting.** Protection today is the ingest key + payload caps
  (≤500 records, ≤512 KB/request) + Neon quota. If the key leaks and gets
  abused, rotate `INGEST_KEY`. Add Upstash-based rate limiting if it matters.
- **Dashboards.** It's raw SQL. Point Grafana/Metabase at the Neon DB if you
  want charts, or build a `/api/query` read endpoint.
- **Embed a default endpoint/key in the binary.** The client is config-driven
  and off by default. To ship telemetry-on-by-default you'd bake a public
  ingest key into the build — a deliberate product/privacy decision, not done
  here.
