import { startService, installShutdownHandlers, VERSION } from './service-impl.js';

if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const main = async (): Promise<void> => {
  const { port, ipcServer, ipcPath } = await startService();
  process.stderr.write(`[service] extension relay listening on 127.0.0.1:${port}\n`);
  process.stderr.write(`[service] IPC listening on ${ipcPath}\n`);
  installShutdownHandlers(ipcServer, ipcPath);
};

main().catch((error: unknown) => {
  process.stderr.write(`[service] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
