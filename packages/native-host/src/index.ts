import net from 'node:net';
import { WebSocket } from 'ws';
import { startServer } from './service.js';
import { VERSION } from './version.js';

export { VERSION };
const PORT = 7483;

if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// `--service` flag: the bridge is running as the always-on background service
// (launched from autostart or detached spawn). Behaviour is identical to the
// no-flag case today (probe → listen → start), but the explicit flag lets us
// distinguish service-launched bridges in `startedBy` and gives us a hook for
// any future service-only behaviour. We do NOT treat the flag as "skip the
// stdio MCP attach" because that path is harmless when stdin is /dev/null.
const isServiceMode = process.argv.includes('--service');
if (isServiceMode) {
  process.env.AI_BROWSER_COPILOT_STARTED_BY = 'autostart';
}

// Pause stdin so no data is lost during the port probe
process.stdin.pause();

const probe = net.createServer();
probe.listen(PORT, '127.0.0.1', () => {
  // Port free → we are the server
  probe.close(() => startServer(PORT));
});
probe.on('error', () => {
  // Port taken → connect as WS client, proxy stdio ↔ WS
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}?role=mcp`);

  // Collect raw stdin chunks until WS is ready
  const pending: Buffer[] = [];
  let wsReady = false;

  // Auto-detect inbound stdio framing on the first valid message and latch
  // it so outbound replies mirror the same format. The MCP spec is NDJSON;
  // legacy/test harnesses sometimes use LSP-style Content-Length framing.
  let stdioFormat: 'ndjson' | 'lsp' = 'ndjson';
  let formatLatched = false;
  const latch = (f: 'ndjson' | 'lsp'): void => {
    if (!formatLatched) {
      stdioFormat = f;
      formatLatched = true;
    }
  };

  let parseBuf = Buffer.alloc(0);
  let contentLength = -1;

  function feedParser(chunk: Buffer): void {
    parseBuf = Buffer.concat([parseBuf, chunk]);
    while (true) {
      if (contentLength !== -1) {
        if (parseBuf.length < contentLength) break;
        const json = parseBuf.subarray(0, contentLength).toString();
        parseBuf = parseBuf.subarray(contentLength);
        contentLength = -1;
        latch('lsp');
        if (wsReady) ws.send(json);
        continue;
      }

      let i = 0;
      while (
        i < parseBuf.length &&
        (parseBuf[i] === 0x0a || parseBuf[i] === 0x0d || parseBuf[i] === 0x20 || parseBuf[i] === 0x09)
      ) i++;
      if (i > 0) parseBuf = parseBuf.subarray(i);
      if (parseBuf.length === 0) break;

      if (parseBuf[0] === 0x7b /* { */ || parseBuf[0] === 0x5b /* [ */) {
        const nl = parseBuf.indexOf(0x0a);
        if (nl === -1) break;
        const line = parseBuf.subarray(0, nl).toString().replace(/\r$/, '');
        parseBuf = parseBuf.subarray(nl + 1);
        if (line) {
          latch('ndjson');
          if (wsReady) ws.send(line);
        }
        continue;
      }

      const headerEnd = parseBuf.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = parseBuf.subarray(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      parseBuf = parseBuf.subarray(headerEnd + 4);
      if (match) {
        contentLength = parseInt(match[1], 10);
      }
    }
  }

  // Start reading stdin immediately
  process.stdin.on('data', (chunk: Buffer) => {
    if (wsReady) {
      feedParser(Buffer.from(chunk));
    } else {
      pending.push(Buffer.from(chunk));
    }
  });
  process.stdin.resume();

  ws.on('open', () => {
    wsReady = true;
    // Feed buffered chunks
    for (const chunk of pending) feedParser(chunk);
    pending.length = 0;

    ws.on('message', (data) => {
      const body = data.toString();
      if (stdioFormat === 'lsp') {
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      } else {
        process.stdout.write(`${body}\n`);
      }
    });
  });

  ws.on('close', () => process.exit(0));
  ws.on('error', () => process.exit(1));
  process.stdin.on('end', () => { ws.close(); process.exit(0); });
});
