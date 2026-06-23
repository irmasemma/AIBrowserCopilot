/**
 * Single-snapshot service status for the bridge.
 *
 * Walks the discovery chain in one helper call so the extension popup is not
 * making 4–5 round-trips through Chrome native messaging (which would
 * otherwise be both slow and racey — each call is a separate helper process,
 * each one a separate moment in time).
 *
 * Order of checks (each one short-circuits to the next on failure):
 *   1. Lock file present + parseable
 *   2. PID alive
 *   3. TCP connect to lock.port succeeds
 *   4. WebSocket handshake succeeds and the first message is server_info
 *      with a matching PID, within 3 s
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch as osArch } from 'node:os';
import { createConnection } from 'node:net';
import { WebSocket } from 'ws';
import { resolveInstallDir } from './install-dir.js';

export const DEFAULT_PORT = 7483;
const TCP_PROBE_TIMEOUT_MS = 1000;
const WS_PROBE_TIMEOUT_MS = 3000;

export interface LockFileInfo {
  exists: boolean;
  pid?: number;
  port?: number;
  version?: string;
  startedBy?: string;
  startedAt?: string;
}

export interface ServiceStatus {
  helperVersion: string;
  installDir: string;
  binaryPath: string;
  binaryExists: boolean;
  lockFile: LockFileInfo;
  pidAlive: boolean | null;
  portListening: boolean;
  wsHealthy: boolean;
  wsHealthyError?: string;
  reportedVersion?: string;
  reportedPid?: number;
  reportedBuildId?: string;
  url: string;
  /**
   * Convenience field for the extension UI: a single-word reason that
   * mirrors DiagnosticReason on the extension side. Computed by walking
   * the chain top-down. Possible values:
   *   'no_lock_file' | 'bridge_not_started' | 'server_not_responding' |
   *   'protocol_timeout' | 'connecting'
   */
  reason: ServiceReason;
}

export type ServiceReason =
  | 'no_lock_file'
  | 'bridge_not_started'
  | 'server_not_responding'
  | 'protocol_timeout'
  | 'connecting';

export function getInstallDir(): string {
  return resolveInstallDir();
}

export function getLockFilePath(): string {
  return join(getInstallDir(), 'server.lock');
}

export function getBinaryPath(): string {
  const dir = getInstallDir();
  // os.arch() reflects the *runtime* architecture of the Node binary we're
  // executing as. On Windows ARM64 the user runs an arm64 helper, expects an
  // arm64 bridge — hardcoding x64 here means the bridge never starts on
  // ARM64 laptops (Surface Pro X / Snapdragon X). Mirror mcp-registrar.ts's
  // resolution so the helper agrees with itself across modules.
  const arch = osArch() === 'arm64' ? 'arm64' : 'x64';
  switch (platform()) {
    case 'win32':
      return join(dir, `agenthub-win-${arch}.exe`);
    case 'darwin':
      return join(dir, `agenthub-macos-${arch}`);
    default:
      return join(dir, `agenthub-linux-${arch}`);
  }
}

export function readLockFile(): LockFileInfo {
  const path = getLockFilePath();
  if (!existsSync(path)) return { exists: false };
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      exists: true,
      pid: typeof data.pid === 'number' ? data.pid : undefined,
      port: typeof data.port === 'number' ? data.port : undefined,
      version: typeof data.version === 'string' ? data.version : undefined,
      startedBy: typeof data.startedBy === 'string' ? data.startedBy : undefined,
      startedAt: typeof data.startedAt === 'string' ? data.startedAt : undefined,
    };
  } catch {
    return { exists: true };
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function probePort(port: number, timeoutMs: number = TCP_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    let done = false;
    const finish = (listening: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(listening);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    sock.once('timeout', () => finish(false));
  });
}

export interface WsProbeResult {
  ok: boolean;
  error?: string;
  reportedPid?: number;
  reportedVersion?: string;
  reportedBuildId?: string;
}

export function probeWebSocket(port: number, expectedPid?: number, timeoutMs: number = WS_PROBE_TIMEOUT_MS): Promise<WsProbeResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: WsProbeResult) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };
    const ws = new WebSocket(`ws://127.0.0.1:${port}?browserId=helper-probe`);
    const timer = setTimeout(() => finish({ ok: false, error: 'protocol_timeout' }), timeoutMs);
    ws.on('open', () => { /* keep waiting for server_info */ });
    ws.on('message', (data) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(String(data));
        if (msg.type !== 'server_info') {
          finish({ ok: false, error: 'unexpected_first_message' });
          return;
        }
        if (typeof expectedPid === 'number' && msg.pid !== expectedPid) {
          finish({
            ok: false,
            error: 'wrong_pid',
            reportedPid: msg.pid,
            reportedVersion: msg.version,
            reportedBuildId: msg.buildId,
          });
          return;
        }
        finish({
          ok: true,
          reportedPid: msg.pid,
          reportedVersion: msg.version,
          reportedBuildId: msg.buildId,
        });
      } catch {
        finish({ ok: false, error: 'malformed_server_info' });
      }
    });
    ws.on('error', () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'ws_error' });
    });
    ws.on('close', () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'ws_closed' });
    });
  });
}

export function deriveReason(s: Pick<ServiceStatus, 'lockFile' | 'pidAlive' | 'portListening' | 'wsHealthy' | 'wsHealthyError'>): ServiceReason {
  if (!s.lockFile.exists) return 'no_lock_file';
  // wsHealthy is the strongest positive signal: we successfully completed a
  // WebSocket handshake AND received server_info. If true, the bridge is
  // definitely running — return 'connecting' even if pidAlive disagreed.
  if (s.wsHealthy) return 'connecting';
  // Below this point wsHealthy is false. Use port + pid to triage why.
  if (!s.portListening) {
    // No port listening — bridge process is genuinely absent.
    return 'bridge_not_started';
  }
  // Port listening but WS handshake failed.
  if (s.wsHealthyError === 'protocol_timeout') return 'protocol_timeout';
  return 'server_not_responding';
}

export interface GetServiceStatusOptions {
  helperVersion: string;
  browserId?: string;
  /** Test seam — override port probe + WS probe + lock-file read. */
  overrides?: Partial<{
    readLockFile: () => LockFileInfo;
    isPidAlive: (pid: number) => boolean;
    probePort: (port: number) => Promise<boolean>;
    probeWebSocket: (port: number, expectedPid?: number) => Promise<WsProbeResult>;
    binaryExists: (path: string) => boolean;
  }>;
}

export async function getServiceStatus(opts: GetServiceStatusOptions): Promise<ServiceStatus> {
  const o = opts.overrides ?? {};
  const installDir = getInstallDir();
  const binaryPath = getBinaryPath();
  const binaryExists = (o.binaryExists ?? existsSync)(binaryPath);
  const lockFile = (o.readLockFile ?? readLockFile)();
  const port = lockFile.port ?? DEFAULT_PORT;
  const browserId = opts.browserId ?? 'unknown';
  const url = `ws://127.0.0.1:${port}?browserId=${encodeURIComponent(browserId)}`;

  let pidAlive: boolean | null = null;
  if (lockFile.pid != null) {
    pidAlive = (o.isPidAlive ?? isPidAlive)(lockFile.pid);
  }

  // CRITICAL FIX: probe the port REGARDLESS of pidAlive result.
  //
  // Why: on Windows, `process.kill(pid, 0)` from a pkg-bundled helper
  // sometimes returns false even when the target PID is alive (cross
  // process-tree permission quirks; helper is launched by Chrome and may
  // have a different security context than the bridge launched by autostart).
  // We had a recurring "Bridge isn't running" false alarm in the side panel
  // because pidAlive=false skipped the port probe, derived reason was
  // 'bridge_not_started', UI scared users.
  //
  // Port listening is the only ground truth. If the bridge port is open and
  // a WS handshake completes (probeWebSocket), the bridge IS running. The
  // pidAlive signal becomes advisory (informational), not gating.
  let portListening = false;
  if (lockFile.exists) {
    portListening = await (o.probePort ?? probePort)(port);
  }

  // If port is listening but pidAlive said false, OVERRIDE pidAlive to true.
  // The pid IS alive — the helper's check was wrong, and we have direct
  // network proof. Without this override, the UI reports "pidAlive: false"
  // alongside "WS healthy: true" — confusing and self-contradictory.
  if (portListening && pidAlive === false) {
    pidAlive = true;
  }

  let wsResult: WsProbeResult = { ok: false, error: 'not_attempted' };
  if (portListening) {
    wsResult = await (o.probeWebSocket ?? probeWebSocket)(port, lockFile.pid);
  }

  const partial = {
    lockFile,
    pidAlive,
    portListening,
    wsHealthy: wsResult.ok,
    wsHealthyError: wsResult.ok ? undefined : wsResult.error,
  };

  return {
    helperVersion: opts.helperVersion,
    installDir,
    binaryPath,
    binaryExists,
    ...partial,
    reportedVersion: wsResult.reportedVersion,
    reportedPid: wsResult.reportedPid,
    reportedBuildId: wsResult.reportedBuildId,
    url,
    reason: deriveReason(partial),
  };
}
