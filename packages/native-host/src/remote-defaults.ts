/**
 * Build-time-injected remote-log defaults.
 *
 * The real ingest endpoint + key are injected by esbuild `define` at bundle
 * time (see `scripts/build-bundle.mjs`, fed from the AGENTHUB_INGEST_ENDPOINT /
 * AGENTHUB_INGEST_KEY env vars). They are NEVER written to source — this file
 * only declares the injected globals and falls back to empty strings.
 *
 * Consequences:
 *   - Release binary (compiled with the env set): REMOTE_DEFAULTS is populated
 *     → the packaged client ships logs to Neon by default.
 *   - Dev / test build (plain `tsc`, no `define`): globals are undefined →
 *     REMOTE_DEFAULTS is empty → no baked-in shipping (opt-in via
 *     logs-config.json still works).
 *
 * The injected key is the append-only INGEST key (Sentry-DSN style — safe to
 * ship in the binary), NOT a database credential.
 */

// These identifiers are replaced with string literals by esbuild `--define`.
// Without the define (tsc/vitest) they are simply undefined at runtime; the
// `typeof` guards keep that from throwing.
declare const __AGENTHUB_INGEST_ENDPOINT__: string | undefined;
declare const __AGENTHUB_INGEST_KEY__: string | undefined;

export const REMOTE_DEFAULTS: { endpoint: string; apiKey: string } = {
  endpoint: typeof __AGENTHUB_INGEST_ENDPOINT__ !== 'undefined' ? __AGENTHUB_INGEST_ENDPOINT__ : '',
  apiKey: typeof __AGENTHUB_INGEST_KEY__ !== 'undefined' ? __AGENTHUB_INGEST_KEY__ : '',
};
