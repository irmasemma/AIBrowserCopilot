import net from 'node:net';
import { WebSocket } from 'ws';
import { startServer } from './service.js';

export const VERSION = '0.2.0';
const PORT = 7483;

if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
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

  // Parser that handles Content-Length framing
  let parseBuf = Buffer.alloc(0);
  let contentLength = -1;

  function feedParser(chunk: Buffer): void {
    parseBuf = Buffer.concat([parseBuf, chunk]);
    while (true) {
      if (contentLength === -1) {
        const headerEnd = parseBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = parseBuf.subarray(0, headerEnd).toString();
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) { parseBuf = parseBuf.subarray(headerEnd + 4); continue; }
        contentLength = parseInt(match[1], 10);
        parseBuf = parseBuf.subarray(headerEnd + 4);
      }
      if (contentLength >= 0 && parseBuf.length >= contentLength) {
        const json = parseBuf.subarray(0, contentLength).toString();
        parseBuf = parseBuf.subarray(contentLength);
        contentLength = -1;
        if (wsReady) ws.send(json);
      } else {
        break;
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
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  });

  ws.on('close', () => process.exit(0));
  ws.on('error', () => process.exit(1));
  process.stdin.on('end', () => { ws.close(); process.exit(0); });
});
