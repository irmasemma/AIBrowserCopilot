#!/usr/bin/env node
/**
 * One-shot verification: spawn the compiled binary, send NDJSON `initialize`
 * (the actual MCP wire format), assert NDJSON response within 5s.
 *
 * Run with:  node packages/native-host/scripts/verify-ndjson.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.resolve(here, '..', 'bin', 'agenthub-win-x64.exe');

const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });

let stdoutBuf = '';
let stderrBuf = '';
child.stdout.on('data', (c) => { stdoutBuf += c.toString(); });
child.stderr.on('data', (c) => { stderrBuf += c.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(800);
  console.log('[stderr boot]', stderrBuf.split('\n').filter(Boolean).join(' | '));

  const req = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '0' } },
  });
  console.log('[send]', req);
  child.stdin.write(`${req}\n`);

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const nl = stdoutBuf.indexOf('\n');
    if (nl !== -1) {
      const line = stdoutBuf.slice(0, nl).replace(/\r$/, '');
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.startsWith('{')) {
        console.log('[recv]', line);
        const msg = JSON.parse(line);
        if (msg.id === 1 && msg.result?.serverInfo?.name === 'agenthub') {
          console.log('OK: NDJSON initialize round-trip succeeded');
          child.kill();
          process.exit(0);
        }
      }
      continue;
    }
    await sleep(100);
  }

  console.error('FAIL: no NDJSON response within 5s');
  console.error('stdout buffer was:', JSON.stringify(stdoutBuf.slice(0, 500)));
  console.error('stderr was:', stderrBuf.slice(0, 500));
  child.kill();
  process.exit(1);
})();
