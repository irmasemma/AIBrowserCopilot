/**
 * Tests for the opt-in remote log sink. We stand up a throwaway local HTTP
 * server, point the sink's endpoint at it, drive records through the REAL
 * logging path (`makeLogger().info`), and assert on what the server receives.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLogger, _resetForTest as resetLogger } from './shared/logger.js';
import { initRemoteSink, _resetForTest as resetSink } from './remote-sink.js';

interface Captured {
  installId?: string;
  records?: Array<Record<string, unknown>>;
}

function startServer(): Promise<{
  url: string;
  next: () => Promise<{ body: Captured; key: string | undefined }>;
  close: () => void;
}> {
  const queue: Array<{ body: Captured; key: string | undefined }> = [];
  const waiters: Array<(v: { body: Captured; key: string | undefined }) => void> = [];

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const item = {
        body: raw ? (JSON.parse(raw) as Captured) : {},
        key: req.headers['x-ingest-key'] as string | undefined,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"inserted":1}');
      const w = waiters.shift();
      if (w) w(item);
      else queue.push(item);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/api/logs`,
        next: () =>
          new Promise((res) => {
            const q = queue.shift();
            if (q) res(q);
            else waiters.push(res);
          }),
        close: () => server.close(),
      });
    });
  });
}

let installDir: string | null = null;
let server: Awaited<ReturnType<typeof startServer>> | null = null;

afterEach(() => {
  resetSink();
  resetLogger();
  if (server) {
    server.close();
    server = null;
  }
  if (installDir) {
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    installDir = null;
  }
});

function setup(remote: Record<string, unknown> | null): { logPath: string } {
  installDir = mkdtempSync(join(tmpdir(), 'agenthub-sink-'));
  mkdirSync(join(installDir, 'logs'), { recursive: true });
  const config: Record<string, unknown> = { enabled: true };
  if (remote) config.remote = remote;
  writeFileSync(join(installDir, 'logs-config.json'), JSON.stringify(config), 'utf-8');
  return { logPath: join(installDir, 'logs', 'bridge.log') };
}

describe('remote-sink', () => {
  it('ships a batched record to the endpoint with the api key', async () => {
    server = await startServer();
    const { logPath } = setup({
      enabled: true,
      endpoint: server.url,
      apiKey: 'secret-key',
      maxBatch: 1, // flush immediately on first record
    });

    initRemoteSink(installDir!);
    const log = makeLogger({ filePath: logPath }, 'bridge', 4242);
    log.info('bridge.test.event', { mcpId: 7 });

    const received = await server.next();
    expect(received.key).toBe('secret-key');
    expect(received.body.installId).toBeTruthy();
    expect(received.body.records).toHaveLength(1);
    const rec = received.body.records![0];
    expect(rec.event).toBe('bridge.test.event');
    expect(rec.src).toBe('bridge');
    expect(rec.mcpId).toBe(7);
    expect(rec.t).toBeTruthy(); // timestamp stamped
  });

  it('does NOT ship when remote config is absent', async () => {
    const { logPath } = setup(null);
    initRemoteSink(installDir!);
    const log = makeLogger({ filePath: logPath }, 'bridge', 1);
    // Should be a no-op tee — nothing to assert against a server, so just
    // confirm it doesn't throw and the tee was never wired (no endpoint).
    expect(() => log.info('bridge.test.event')).not.toThrow();
  });

  it('does NOT ship when remote.enabled is false', async () => {
    server = await startServer();
    const { logPath } = setup({
      enabled: false,
      endpoint: server.url,
      apiKey: 'k',
      maxBatch: 1,
    });
    initRemoteSink(installDir!);
    const log = makeLogger({ filePath: logPath }, 'bridge', 1);
    log.info('bridge.test.event');

    // Give any erroneous POST a chance to land, then assert none did.
    const race = await Promise.race([
      server.next().then(() => 'posted'),
      new Promise((r) => setTimeout(() => r('quiet'), 150)),
    ]);
    expect(race).toBe('quiet');
  });

  it('honours the master kill-switch (enabled:false)', async () => {
    server = await startServer();
    installDir = mkdtempSync(join(tmpdir(), 'agenthub-sink-'));
    mkdirSync(join(installDir, 'logs'), { recursive: true });
    writeFileSync(
      join(installDir, 'logs-config.json'),
      JSON.stringify({
        enabled: false, // master off
        remote: { enabled: true, endpoint: server.url, apiKey: 'k', maxBatch: 1 },
      }),
      'utf-8',
    );
    initRemoteSink(installDir);
    const log = makeLogger({ filePath: join(installDir, 'logs', 'bridge.log') }, 'bridge', 1);
    log.info('bridge.test.event');

    const race = await Promise.race([
      server.next().then(() => 'posted'),
      new Promise((r) => setTimeout(() => r('quiet'), 150)),
    ]);
    expect(race).toBe('quiet');
  });
});
