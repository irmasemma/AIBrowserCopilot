// Real-bridge harness for connection-resilience.spec.ts.
//
// Spawned as a child process by the spec. Runs the ACTUAL exported
// startServer() — same code path the shipped bridge uses — on a caller-chosen
// port, with the lock file + logs redirected to an isolated LOCALAPPDATA so the
// test never touches the user's real %LOCALAPPDATA%\agenthub or the live 7483
// bridge. The spec detects readiness by connecting a real WebSocket and waiting
// for server_info; on a lost port-bind race startServer exits on its own.
import { startServer } from '../../../packages/native-host/dist/service.js';

const port = Number(process.env.AGENTHUB_TEST_PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error('AGENTHUB_TEST_PORT must be a positive integer');
  process.exit(2);
}

startServer(port);
