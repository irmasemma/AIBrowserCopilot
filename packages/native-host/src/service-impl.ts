import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { platform } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { startRelay, setStartedBy } from './extension-relay.js';
import { getDefaultIpcPath, getStartingLockPath } from './lock-file-manager.js';

export const VERSION = '0.2.0';

export function detectStartedBy(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): string {
  const flag = argv.find((a) => a.startsWith('--started-by='));
  if (flag) return flag.split('=')[1] ?? 'unknown';
  if (env['COPILOT_STARTED_BY']) return env['COPILOT_STARTED_BY'];
  return 'service';
}

let stubCounter = 0;

export function handleStubConnection(socket: net.Socket): void {
  const stubId = ++stubCounter;

  // Each stub gets its own MCP server bound to its socket. Tool handlers all
  // share the singleton extension WS via sendToExtension, so concurrent calls
  // from different stubs interleave correctly.
  const server = createMcpServer();
  const transport = new StdioServerTransport(socket, socket);

  server.connect(transport).catch((err: unknown) => {
    process.stderr.write(`[service] stub ${stubId} transport error: ${err instanceof Error ? err.message : String(err)}\n`);
    socket.destroy();
  });

  socket.on('close', () => {
    server.close().catch(() => undefined);
  });

  socket.on('error', (err) => {
    process.stderr.write(`[service] stub ${stubId} socket error: ${err.message}\n`);
  });
}

export function startIpcServer(ipcPath: string): Promise<net.Server> {
  // Unix sockets need stale-file cleanup; Windows named pipes do not.
  if (platform() !== 'win32' && existsSync(ipcPath)) {
    try { unlinkSync(ipcPath); } catch { /* best effort */ }
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer(handleStubConnection);
    server.on('error', reject);
    server.listen(ipcPath, () => resolve(server));
  });
}

export async function startService(): Promise<{ port: number; ipcServer: net.Server; ipcPath: string }> {
  const ipcPath = getDefaultIpcPath();
  setStartedBy(detectStartedBy());

  const port = await startRelay({ ipcPath });
  const ipcServer = await startIpcServer(ipcPath);

  // Best-effort cleanup of the .starting lock used by stubs to coordinate spawn races.
  try {
    const startingLock = getStartingLockPath();
    if (existsSync(startingLock)) unlinkSync(startingLock);
  } catch {
    // Best effort
  }

  return { port, ipcServer, ipcPath };
}

export function installShutdownHandlers(ipcServer: net.Server, ipcPath: string): void {
  const shutdown = (signal: string) => {
    process.stderr.write(`[service] received ${signal}, shutting down\n`);
    ipcServer.close();
    if (platform() !== 'win32') {
      try { unlinkSync(ipcPath); } catch { /* best effort */ }
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
