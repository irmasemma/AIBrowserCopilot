/**
 * Bundle the native host with esbuild, injecting the remote-log ingest
 * endpoint + key from env at BUILD time (never from source).
 *
 *   AGENTHUB_INGEST_ENDPOINT  — e.g. https://<app>.vercel.app/api/logs
 *   AGENTHUB_INGEST_KEY       — the append-only INGEST key (ships in the binary)
 *
 * Release builds (CI or local) MUST export both so the packaged client ships
 * logs to Neon by default. Omit them for a dev build → remote stays off.
 * The values land only in the compiled bin/bundle.cjs (and the pkg .exe), not
 * in any committed file.
 */
import { build } from 'esbuild';

const endpoint = process.env.AGENTHUB_INGEST_ENDPOINT ?? '';
const apiKey = process.env.AGENTHUB_INGEST_KEY ?? '';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'bin/bundle.cjs',
  define: {
    __AGENTHUB_INGEST_ENDPOINT__: JSON.stringify(endpoint),
    __AGENTHUB_INGEST_KEY__: JSON.stringify(apiKey),
  },
});

console.log(
  `[build-bundle] bundled → bin/bundle.cjs  (ingest endpoint: ${endpoint ? 'SET' : 'empty'}, key: ${apiKey ? 'SET' : 'empty'})`,
);
