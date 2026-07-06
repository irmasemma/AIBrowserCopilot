/**
 * Test-only static HTTP fixture server.
 *
 * WHY: The `chromium-extension` Playwright project loads the unpacked
 * extension, whose `<all_urls>` is an *optional* host permission. Unpacked
 * extensions get no `file://` access by default, so `chrome.scripting
 * .executeScript` on a `file://` fixture fails with:
 *
 *   "Cannot access contents of url 'file:///.../x.html'. Extension manifest
 *    must request permission to access this host."
 *
 * The extension's REQUIRED host permissions include `http://127.0.0.1/*`, so
 * serving the fixtures over `http://127.0.0.1:<port>/...` lets content scripts
 * read them without the optional grant — exactly like the specs that already
 * pass (threads-export-bundled, multi-profile-fanout, etc.).
 *
 * Free-port convention: bind to an OS-assigned ephemeral port via `.listen(0)`
 * (see docs/e2e-tests.md) rather than picking from a fixed range — this avoids
 * the port-collision flakes seen on Windows.
 *
 * Usage:
 *   let fixtures: FixtureServer;
 *   test.beforeAll(async () => { fixtures = await startFixtureServer(); });
 *   test.afterAll(async () => { await fixtures.close(); });
 *   // then: await page.goto(fixtures.url('form-simple.html'));
 *   //  or : await page.goto(fixtures.url('stress/form-01-plain.html'));
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/** Root dir the server serves from — the shared e2e fixtures directory. */
const FIXTURES_ROOT = path.resolve(__dirname, '../fixtures');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export interface FixtureServer {
  /** Base origin, e.g. "http://127.0.0.1:54321". */
  readonly origin: string;
  /** The OS-assigned port. */
  readonly port: number;
  /**
   * Absolute http URL for a fixture, relative to the fixtures/ root.
   * e.g. url('form-simple.html') or url('stress/form-01-plain.html').
   */
  url(relativePath: string): string;
  /** Stop the server. */
  close(): Promise<void>;
}

/**
 * Start an http server on 127.0.0.1 serving files from tests/e2e/fixtures/.
 * Binds to an ephemeral port via .listen(0). Path traversal outside the
 * fixtures root is rejected with 403.
 */
export async function startFixtureServer(rootDir: string = FIXTURES_ROOT): Promise<FixtureServer> {
  const root = path.resolve(rootDir);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        // Strip query/hash, decode, and normalize to a path under root.
        const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
        const rel = rawPath.replace(/^\/+/, '');
        const filePath = path.resolve(root, rel);

        // Reject anything that escapes the fixtures root.
        if (filePath !== root && !filePath.startsWith(root + path.sep)) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }

        const body = await readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    port,
    url(relativePath: string): string {
      const clean = relativePath.replace(/^\/+/, '');
      return `${origin}/${clean}`;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
