/**
 * POST /api/logs — batched log ingest for AgentHub remote logging.
 *
 * Body: { installId: string, records: LogRecord[] }
 * Auth: header `x-ingest-key` must equal env `INGEST_KEY`.
 *
 * The whole batch is inserted in ONE round trip via `jsonb_array_elements`,
 * extracting the common columns (ts/src/lvl/pid/event/version) for cheap
 * filtering while keeping the full record in a `fields` jsonb column.
 *
 * This endpoint is reachable by anyone who has the ingest key (it ships,
 * Sentry-DSN style, with the client). Treat the key as low-secret: it is
 * rate-limited by payload caps here, quota-limited by Neon, and revocable
 * by rotating INGEST_KEY. It grants append-only log writes, nothing else.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

// Guard rails so one request can't blow the function memory or the DB.
const MAX_RECORDS = 500;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

const sql = neon(process.env.DATABASE_URL ?? '');

interface LogRecord {
  t?: string;
  src?: string;
  lvl?: string;
  pid?: number | null;
  event?: string;
  version?: string;
  [k: string]: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  // Auth — constant-ish comparison is overkill for an append-only key, but
  // reject fast and quietly on mismatch.
  const expected = process.env.INGEST_KEY;
  if (!expected || req.headers['x-ingest-key'] !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (!process.env.DATABASE_URL) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  // Body size guard. Vercel gives us a parsed object; re-measure defensively.
  const rawLen = Number(req.headers['content-length'] ?? 0);
  if (rawLen > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }

  const body = req.body as { installId?: unknown; records?: unknown } | undefined;
  const installId = typeof body?.installId === 'string' ? body.installId.slice(0, 128) : null;
  const records = Array.isArray(body?.records) ? (body!.records as LogRecord[]) : null;

  if (!installId || !records) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }
  if (records.length === 0) {
    res.status(200).json({ inserted: 0 });
    return;
  }
  if (records.length > MAX_RECORDS) {
    res.status(413).json({ error: 'too_many_records', max: MAX_RECORDS });
    return;
  }

  try {
    // One INSERT for the whole batch. Each record's common fields are pulled
    // out of the jsonb; the full record is stored in `fields`.
    await sql`
      INSERT INTO logs (install_id, ts, src, lvl, pid, event, version, fields)
      SELECT
        ${installId},
        NULLIF(r->>'t', '')::timestamptz,
        r->>'src',
        r->>'lvl',
        NULLIF(r->>'pid', '')::int,
        r->>'event',
        r->>'version',
        r
      FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb) AS r
    `;
    res.status(200).json({ inserted: records.length });
  } catch (err) {
    // Don't leak DB internals to a public endpoint.
    console.error('ingest_failed', err);
    res.status(500).json({ error: 'ingest_failed' });
  }
}
