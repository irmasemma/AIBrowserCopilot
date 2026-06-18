/**
 * Remote log sink — opt-in, batched upload of NDJSON records to a remote
 * ingest endpoint (a Vercel serverless function backed by Neon Postgres).
 *
 * Design constraints (mirrors `shared/logger.ts`):
 *
 *   - **Opt-in.** Off unless `logs-config.json` has `remote.enabled === true`
 *     AND a valid `endpoint` + `apiKey`. The master `enabled:false` switch in
 *     the same file also disables remote shipping (the tee lives behind it).
 *
 *   - **Fire-and-forget.** Records are enqueued synchronously from the hot
 *     logging path; the actual POST happens on a timer (or when the batch
 *     fills). The logging call never waits on the network.
 *
 *   - **Never throws, never blocks.** Any failure (bad URL, network down,
 *     5xx) drops the batch silently. Telemetry is best-effort; losing logs
 *     is always preferable to disturbing the bridge.
 *
 *   - **Bounded memory.** The buffer is capped; on overflow the OLDEST
 *     records are dropped so a long network outage can't grow it unbounded.
 *
 *   - **No `fetch`.** Uses the built-in `node:https`/`node:http` request API
 *     so it behaves identically in dev (tsc/node) and in the `pkg`-compiled
 *     binary, with no dependency on global `fetch` being present.
 *
 * Redaction is NOT done here — records arrive already redacted from the same
 * pipeline that writes the local files (see `shared/logger.ts` + `redaction`).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { setRemoteTee, type LogRecord } from './shared/logger.js';

interface RemoteConfig {
  endpoint: string;
  apiKey: string;
  flushIntervalMs: number;
  maxBatch: number;
  maxBufferRecords: number;
}

interface ActiveConfig extends RemoteConfig {
  installId: string;
}

const DEFAULTS = {
  flushIntervalMs: 5_000,
  maxBatch: 50,
  maxBufferRecords: 1_000,
  /** Hard cap on a single POST so one flush can't send a huge body. */
  postTimeoutMs: 8_000,
};

let cfg: ActiveConfig | null = null;
let buffer: LogRecord[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Parse the `remote` block out of `<installDir>/logs-config.json`. Returns
 * null (remote disabled) unless logging is enabled, `remote.enabled` is the
 * literal `true`, and both `endpoint` and `apiKey` are present strings.
 */
function readRemoteConfig(installDir: string): RemoteConfig | null {
  try {
    const raw = readFileSync(join(installDir, 'logs-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      remote?: {
        enabled?: unknown;
        endpoint?: unknown;
        apiKey?: unknown;
        flushIntervalMs?: unknown;
        maxBatch?: unknown;
        maxBufferRecords?: unknown;
      };
    };
    if (parsed.enabled === false) return null; // master kill-switch
    const r = parsed.remote;
    if (!r || r.enabled !== true) return null; // remote is opt-in
    if (typeof r.endpoint !== 'string' || typeof r.apiKey !== 'string') return null;
    if (!r.endpoint || !r.apiKey) return null;
    return {
      endpoint: r.endpoint,
      apiKey: r.apiKey,
      flushIntervalMs: num(r.flushIntervalMs, DEFAULTS.flushIntervalMs),
      maxBatch: num(r.maxBatch, DEFAULTS.maxBatch),
      maxBufferRecords: num(r.maxBufferRecords, DEFAULTS.maxBufferRecords),
    };
  } catch {
    // Absent or malformed config → remote off (fail-closed for shipping).
    return null;
  }
}

/**
 * Stable per-machine id so logs from the same install correlate across
 * bridge restarts. Persisted to `<installDir>/install-id`; generated once.
 * This is a random UUID, NOT anything derived from the user or hardware —
 * it identifies an install, not a person.
 */
function getInstallId(installDir: string): string {
  const p = join(installDir, 'install-id');
  try {
    if (existsSync(p)) {
      const existing = readFileSync(p, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch {
    // fall through to generate
  }
  const id = randomUUID();
  try {
    writeFileSync(p, id, 'utf-8');
  } catch {
    // Read-only disk — use the ephemeral id for this session.
  }
  return id;
}

/** POST a JSON body. Resolves on success OR failure (never rejects). */
function postBatch(endpoint: string, apiKey: string, body: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let u: URL;
    try {
      u = new URL(endpoint);
    } catch {
      return resolve();
    }
    const lib = u.protocol === 'http:' ? httpRequest : httpsRequest;
    const payload = Buffer.from(body, 'utf-8');
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const req = lib(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || undefined,
          path: u.pathname + u.search,
          headers: {
            'content-type': 'application/json',
            'content-length': payload.length,
            'x-ingest-key': apiKey,
          },
          timeout: DEFAULTS.postTimeoutMs,
        },
        (res) => {
          res.on('data', () => {
            /* drain so the socket can be freed */
          });
          res.on('end', done);
          res.on('error', done);
        },
      );
      req.on('error', done);
      req.on('timeout', () => {
        req.destroy();
        done();
      });
      req.write(payload);
      req.end();
    } catch {
      done();
    }
  });
}

/** Enqueue one record. Synchronous, bounded, never throws. */
function enqueue(rec: LogRecord): void {
  if (!cfg) return;
  const copy: LogRecord = { ...rec };
  if (!copy.t) copy.t = new Date().toISOString();
  buffer.push(copy);
  if (buffer.length > cfg.maxBufferRecords) {
    // Drop oldest to stay bounded during an outage.
    buffer.splice(0, buffer.length - cfg.maxBufferRecords);
  }
  if (buffer.length >= cfg.maxBatch) void flush();
}

/** Send up to one batch. Re-entrancy guarded; drops the batch on failure. */
async function flush(): Promise<void> {
  if (flushing || !cfg || buffer.length === 0) return;
  flushing = true;
  const active = cfg;
  const batch = buffer.splice(0, active.maxBatch);
  try {
    const body = JSON.stringify({ installId: active.installId, records: batch });
    await postBatch(active.endpoint, active.apiKey, body);
  } catch {
    // Batch dropped. Intentional: avoids unbounded retry growth.
  } finally {
    flushing = false;
  }
}

let shutdownHooked = false;

/**
 * Initialise (or tear down) the remote sink from on-disk config. Idempotent —
 * safe to call once at startup. If remote is disabled it clears any tee so a
 * prior config can be turned off by editing logs-config.json and restarting.
 */
export function initRemoteSink(installDir: string): void {
  const rc = readRemoteConfig(installDir);
  if (!rc) {
    cfg = null;
    setRemoteTee(null);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return;
  }

  cfg = { ...rc, installId: getInstallId(installDir) };
  buffer = [];
  setRemoteTee(enqueue);

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void flush();
  }, cfg.flushIntervalMs);
  // Don't let the flush timer keep the process alive on its own.
  if (typeof timer.unref === 'function') timer.unref();

  if (!shutdownHooked) {
    shutdownHooked = true;
    // Best-effort final flush. These can't await async work to completion,
    // but they give an in-flight buffer a chance to leave.
    process.once('beforeExit', () => {
      void flush();
    });
    process.once('SIGINT', () => {
      void flush();
    });
    process.once('SIGTERM', () => {
      void flush();
    });
  }
}

/** Test seam: reset all module state. */
export function _resetForTest(): void {
  cfg = null;
  buffer = [];
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  flushing = false;
  setRemoteTee(null);
}
