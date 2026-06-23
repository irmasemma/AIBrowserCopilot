-- AgentHub remote-log schema for Neon Postgres.
-- Run this once against your Neon database (Neon SQL Editor, or `psql`).
--
--   psql "$DATABASE_URL" -f schema.sql
--
-- One row per log record. Common fields are promoted to columns for cheap
-- filtering; the full NDJSON record is kept in `fields` (jsonb) so nothing is
-- lost and you can query arbitrary correlation ids (mcpId, browserBoundId, …).

CREATE TABLE IF NOT EXISTS logs (
  id           bigserial    PRIMARY KEY,
  received_at  timestamptz  NOT NULL DEFAULT now(),  -- when the ingest endpoint stored it
  install_id   text         NOT NULL,                -- stable per-machine id
  ts           timestamptz,                          -- record's own timestamp (`t`)
  src          text,                                 -- bridge | ext | helper
  lvl          text,                                 -- info | warn | error
  pid          integer,
  event        text,                                 -- kebab-case event name
  version      text,                                 -- bridge version, when present
  fields       jsonb        NOT NULL                 -- the full record
);

-- Time scans (the prune sweep + "show me the last hour").
CREATE INDEX IF NOT EXISTS logs_received_at_idx ON logs (received_at);

-- "Everything from this machine, newest first" — the main troubleshooting view.
CREATE INDEX IF NOT EXISTS logs_install_time_idx ON logs (install_id, received_at DESC);

-- Filter by event name.
CREATE INDEX IF NOT EXISTS logs_event_idx ON logs (event);

-- Cheap "show me only problems" — partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS logs_problems_idx
  ON logs (received_at DESC)
  WHERE lvl IN ('warn', 'error');

-- Arbitrary correlation-id lookups inside the record
-- (e.g. fields->>'mcpId', fields->>'browserBoundId').
CREATE INDEX IF NOT EXISTS logs_fields_gin_idx ON logs USING gin (fields);

-- ── Handy queries ──────────────────────────────────────────────────────────
-- Last 100 problems across all installs:
--   SELECT received_at, install_id, src, event, fields
--   FROM logs WHERE lvl IN ('warn','error')
--   ORDER BY received_at DESC LIMIT 100;
--
-- Full call chain for one MCP id on one machine:
--   SELECT ts, src, event, fields
--   FROM logs
--   WHERE install_id = '<id>' AND fields->>'mcpId' = '42'
--   ORDER BY ts;
--
-- Error rate per day:
--   SELECT date_trunc('day', received_at) d,
--          count(*) FILTER (WHERE lvl='error') errors, count(*) total
--   FROM logs GROUP BY d ORDER BY d DESC;
