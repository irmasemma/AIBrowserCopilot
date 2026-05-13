import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { VERSION } from './version';

const BINARY_PATH = join(__dirname, '..', 'bin', 'agenthub-win-x64.exe');
const PORT = 7483;

const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });

/**
 * Smoke tests for the compiled binary.
 * Only tests that don't interfere with running instances.
 * The full startup test is done manually or in CI where no MCP server is running.
 */
describe('compiled binary smoke test', () => {
  it('binary exists', () => {
    expect(existsSync(BINARY_PATH)).toBe(true);
  });

  it('--version outputs correct version', () => {
    const output = execFileSync(BINARY_PATH, ['--version'], { encoding: 'utf-8', timeout: 15000 });
    expect(output.trim()).toBe(VERSION);
  }, 20000);

  /**
   * Real-world MCP protocol test: VS Code, Claude Desktop, Cursor and the
   * MCP TypeScript SDK all send `JSON.stringify(msg) + '\n'` over stdio
   * (newline-delimited JSON, NOT LSP-style Content-Length framing).
   *
   * This test would have caught the production bug where VS Code logged
   * "Waiting for server to respond to `initialize` request..." forever
   * because our parser only handled Content-Length framing.
   *
   * Skipped if port 7483 is taken (another MCP host already running).
   */
  it('responds to NDJSON `initialize` over stdio (real MCP wire format)', async () => {
    if (!(await isPortFree(PORT))) {
      // eslint-disable-next-line no-console
      console.warn(`Skipping NDJSON test: port ${PORT} in use`);
      return;
    }

    const child = spawn(BINARY_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuf = '';
    child.stdout.on('data', (c: Buffer) => { stdoutBuf += c.toString(); });
    child.stderr.on('data', () => { /* discard */ });

    try {
      // Wait briefly for server to bind.
      await new Promise((r) => setTimeout(r, 500));

      // Send MCP-spec NDJSON initialize.
      const req = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      });
      child.stdin.write(`${req}\n`);

      // Wait up to 5s for an NDJSON response line.
      const deadline = Date.now() + 5000;
      let response: { id?: number; result?: { serverInfo?: { name?: string } } } | null = null;
      while (Date.now() < deadline) {
        const nl = stdoutBuf.indexOf('\n');
        if (nl !== -1) {
          const line = stdoutBuf.slice(0, nl).replace(/\r$/, '');
          if (line.startsWith('{')) {
            response = JSON.parse(line);
            break;
          }
          stdoutBuf = stdoutBuf.slice(nl + 1);
          continue;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(response, `No NDJSON response within 5s. stdout so far: ${stdoutBuf.slice(0, 500)}`).not.toBeNull();
      expect(response!.id).toBe(1);
      expect(response!.result?.serverInfo?.name).toBe('agenthub');
    } finally {
      child.kill();
      // Wait for port to free up so subsequent tests don't conflict.
      const drainDeadline = Date.now() + 3000;
      while (Date.now() < drainDeadline && !(await isPortFree(PORT))) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }, 15000);
});
