import { scanAITools } from './tool-scanner.js';
import { checkClaudeCodeRegistration, repairClaudeCodeRegistration } from './mcp-registrar.js';
import { getServiceStatus } from './service-status.js';
import { startNativeHost } from './process-spawner.js';
import { HELPER_VERSION } from './version.js';
import { logRecord, logErr } from './logger.js';

// Chrome Native Messaging protocol: 4-byte LE length prefix + JSON

function readMessage(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let lengthRead = false;
    let messageLength = 0;
    let bytesRead = 0;

    process.stdin.on('readable', () => {
      if (!lengthRead) {
        const header = process.stdin.read(4) as Buffer | null;
        if (!header) return;
        messageLength = header.readUInt32LE(0);
        lengthRead = true;
      }

      const remaining = messageLength - bytesRead;
      if (remaining <= 0) return;

      const chunk = process.stdin.read(remaining) as Buffer | null;
      if (chunk) {
        chunks.push(chunk);
        bytesRead += chunk.length;
        if (bytesRead >= messageLength) {
          const json = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(JSON.parse(json));
          } catch (err) {
            reject(new Error(`Invalid JSON: ${err}`));
          }
        }
      }
    });

    process.stdin.on('error', reject);
    process.stdin.on('end', () => {
      if (!lengthRead || bytesRead < messageLength) {
        reject(new Error('stdin closed before full message was read'));
      }
    });
  });
}

function writeMessage(data: unknown): void {
  const json = JSON.stringify(data);
  const buffer = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  let action: string | undefined;
  try {
    const message = await readMessage();
    action = message.action as string;
    logRecord({
      event: 'helper.invoke.received',
      action,
      helperVersion: HELPER_VERSION,
      argKeys: Object.keys(message).filter((k) => k !== 'action'),
    });

    switch (action) {
      case 'scan_ai_tools': {
        const tools = scanAITools();
        writeMessage({ tools });
        logRecord({ event: 'helper.invoke.replied', action, durationMs: Date.now() - startedAt, toolCount: tools.length });
        break;
      }

      case 'check_mcp_registration': {
        // Currently Claude Code only — extend with a `tool` parameter when other
        // clients gain a "Re-add" UI surface.
        const result = checkClaudeCodeRegistration();
        writeMessage(result);
        logRecord({
          event: 'helper.invoke.replied',
          action,
          durationMs: Date.now() - startedAt,
          registered: result.registered,
          scope: result.scope,
        });
        break;
      }

      case 'repair_mcp_registration': {
        const result = repairClaudeCodeRegistration();
        writeMessage(result);
        logRecord({
          event: 'helper.invoke.replied',
          action,
          durationMs: Date.now() - startedAt,
          success: result.success,
        });
        break;
      }

      case 'get_service_status': {
        const browserId = typeof message.browserId === 'string' ? message.browserId : undefined;
        const status = await getServiceStatus({ helperVersion: HELPER_VERSION, browserId });
        writeMessage(status);
        logRecord({
          event: 'helper.invoke.replied',
          action,
          durationMs: Date.now() - startedAt,
          reason: status.reason,
          lockFileExists: status.lockFile.exists,
          pidAlive: status.pidAlive,
          portListening: status.portListening,
          wsHealthy: status.wsHealthy,
          reportedPid: status.reportedPid,
          reportedVersion: status.reportedVersion,
        });
        break;
      }

      case 'start_native_host': {
        // Cheap pre-check: avoid spawning a duplicate when the bridge is already healthy.
        const isAlreadyRunning = async (): Promise<boolean> => {
          const status = await getServiceStatus({ helperVersion: HELPER_VERSION });
          return status.wsHealthy;
        };
        const result = await startNativeHost({ isAlreadyRunning });
        writeMessage(result);
        logRecord({
          event: 'helper.invoke.replied',
          action,
          durationMs: Date.now() - startedAt,
          ok: result.ok,
          alreadyRunning: result.alreadyRunning,
          spawnedPid: result.pid,
          errorMessage: result.error,
        });
        break;
      }

      case 'restart_native_host': {
        // For "restart" we want to start fresh — skip the alreadyRunning guard so
        // a stale-but-listening bridge doesn't make us a no-op. Caller is expected
        // to have killed any prior instance first (or the new bridge will become a
        // proxy via the port-probe path).
        const result = await startNativeHost({ skipAlreadyRunningCheck: true });
        writeMessage(result);
        logRecord({
          event: 'helper.invoke.replied',
          action,
          durationMs: Date.now() - startedAt,
          ok: result.ok,
          spawnedPid: result.pid,
          errorMessage: result.error,
        });
        break;
      }

      case 'helper_version': {
        writeMessage({ version: HELPER_VERSION });
        logRecord({ event: 'helper.invoke.replied', action, durationMs: Date.now() - startedAt });
        break;
      }

      default:
        writeMessage({ error: `Unknown action: ${action}` });
        logRecord({
          event: 'helper.invoke.unknown_action',
          lvl: 'warn',
          action,
          durationMs: Date.now() - startedAt,
        });
    }
  } catch (err) {
    writeMessage({ error: String(err) });
    logErr('helper.invoke.error', err, { action, durationMs: Date.now() - startedAt });
  }

  process.exit(0);
}

main();
