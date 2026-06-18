/**
 * GET /api/prune — retention sweep, invoked by Vercel Cron (see vercel.json).
 *
 * Deletes log rows older than RETENTION_DAYS (default 14). This is what keeps
 * a 0.5 GB Neon free tier from filling up — without it, ingest eventually
 * fails on a full database.
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when the CRON_SECRET env var is set. We require it so the endpoint can't be
 * triggered by random traffic. Set CRON_SECRET in the Vercel project settings.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL ?? '');

function retentionDays(): number {
  const n = Number(process.env.RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!process.env.DATABASE_URL) {
    res.status(500).json({ error: 'not_configured' });
    return;
  }

  const days = retentionDays();
  try {
    // interval can't be parameterized directly; days is an integer we control.
    const rows = await sql`
      DELETE FROM logs
      WHERE received_at < now() - make_interval(days => ${days})
      RETURNING 1
    `;
    res.status(200).json({ pruned: rows.length, retentionDays: days });
  } catch (err) {
    console.error('prune_failed', err);
    res.status(500).json({ error: 'prune_failed' });
  }
}
