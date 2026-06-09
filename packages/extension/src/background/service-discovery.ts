import type { DiagnosticReason } from '../shared/types';
import { getBrowserInstanceId } from '../shared/browser-instance-id';
import { logRecord } from '../shared/logger';

const NM_HELPER_NAME = 'com.agenthub.native_host_helper';
const DEFAULT_PORT = 7483;

export interface LockFileInfo {
  exists: boolean;
  pid?: number;
  port?: number;
  token?: string;
  version?: string;
  startedBy?: string;
}

export interface ToolScanResult {
  tool: string;
  slug: string;
  installed: boolean;
  configured: boolean;
  configPath: string;
}

export interface DiscoveryResult {
  url: string;
  token?: string;
  diagnostic: DiagnosticReason;
  /** Snapshot of the bridge service from the helper, when available. */
  serviceStatus?: ServiceStatus;
}

/**
 * Service status snapshot returned by the helper's `get_service_status`
 * action. Mirrors the type defined in `native-host-helper/src/service-status.ts`.
 */
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
  reason: 'no_lock_file' | 'bridge_not_started' | 'server_not_responding' | 'protocol_timeout' | 'connecting';
}

export interface McpRegistrationStatus {
  available: boolean; // false → helper unavailable; treat UI as unknown
  configExists: boolean;
  configPath: string;
  registered: boolean;
  scope: 'user' | 'project' | null;
  binaryPath: string;
  binaryExists: boolean;
}

export interface McpRegistrationRepairResult {
  success: boolean;
  configPath: string;
  binaryPath: string;
  scope: 'user';
  backupPath?: string;
  error?: string;
}

export interface StartNativeHostResult {
  ok: boolean;
  pid?: number;
  alreadyRunning?: boolean;
  error?: string;
  binaryPath?: string;
}

export interface ServiceDiscovery {
  discoverEndpoint(): Promise<DiscoveryResult>;
  scanTools(): Promise<ToolScanResult[]>;
  checkMcpRegistration(): Promise<McpRegistrationStatus>;
  repairMcpRegistration(): Promise<McpRegistrationRepairResult>;
  getServiceStatus(): Promise<ServiceStatus | null>;
  startNativeHost(): Promise<StartNativeHostResult>;
  restartNativeHost(): Promise<StartNativeHostResult>;
}

export function createServiceDiscovery(): ServiceDiscovery {
  async function sendNativeMessage(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    void logRecord({ event: 'ext.helper.invoke.start', action });
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendNativeMessage) {
        chrome.runtime.sendNativeMessage(NM_HELPER_NAME, { action, ...extra }, (response) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message ?? 'unknown';
            void logRecord({
              event: 'ext.helper.invoke.error',
              lvl: 'warn',
              action,
              durationMs: Date.now() - startedAt,
              errorMessage: errMsg,
            });
            reject(new Error(errMsg));
          } else {
            void logRecord({
              event: 'ext.helper.invoke.complete',
              action,
              durationMs: Date.now() - startedAt,
              responseKeys: response ? Object.keys(response) : [],
            });
            resolve(response as Record<string, unknown>);
          }
        });
      } else {
        void logRecord({
          event: 'ext.helper.invoke.error',
          lvl: 'warn',
          action,
          errorMessage: 'native_messaging_unavailable',
        });
        reject(new Error('Native messaging not available'));
      }
    });
  }

  async function fetchServiceStatus(browserId: string): Promise<ServiceStatus | null> {
    let response: Record<string, unknown>;
    try {
      response = await sendNativeMessage('get_service_status', { browserId });
    } catch {
      // Helper genuinely not reachable (Chrome's connectNative failed because
      // the manifest isn't registered, or the helper exe is missing).
      return null;
    }
    if (typeof response.reason === 'string' && typeof response.url === 'string') {
      return response as unknown as ServiceStatus;
    }
    // Helper responded but with an unexpected shape — usually a version skew
    // (e.g. user manually ran `npx agenthub-setup` which installs an
    // older published helper whose response format the current extension
    // doesn't recognise). Surface as a recoverable "bridge not running" state
    // so auto-recovery (or the user's "Start AgentHub service" click) can call
    // the helper's `start_native_host` action, which has been stable across
    // versions. Better than collapsing into `helper_unavailable`, which would
    // falsely tell the user to re-run the installer they already ran.
    return {
      helperVersion: typeof response.helperVersion === 'string' ? response.helperVersion : 'unknown',
      installDir: typeof response.installDir === 'string' ? response.installDir : '',
      binaryPath: typeof response.binaryPath === 'string' ? response.binaryPath : '',
      // Optimistically assume the binary is there. If it isn't, start_native_host
      // will fail with a real error the user can act on.
      binaryExists: typeof response.binaryExists === 'boolean' ? response.binaryExists : true,
      lockFile: { exists: false },
      pidAlive: null,
      portListening: false,
      wsHealthy: false,
      url: `ws://127.0.0.1:${DEFAULT_PORT}?browserId=${encodeURIComponent(browserId)}`,
      reason: 'no_lock_file',
    };
  }

  return {
    async discoverEndpoint(): Promise<DiscoveryResult> {
      const browserId = await getBrowserInstanceId();
      const fallbackUrl = `ws://127.0.0.1:${DEFAULT_PORT}?browserId=${encodeURIComponent(browserId)}`;

      const status = await fetchServiceStatus(browserId);
      if (!status) {
        return { url: fallbackUrl, diagnostic: 'helper_unavailable' };
      }

      // The helper's `reason` field maps 1:1 to DiagnosticReason except for
      // 'connecting' which represents a healthy snapshot. We trust the helper
      // to have walked the chain in the right order (no_lock_file →
      // bridge_not_started → server_not_responding → protocol_timeout →
      // connecting).
      const diagnostic: DiagnosticReason = status.reason;
      return {
        url: status.url || fallbackUrl,
        diagnostic,
        serviceStatus: status,
      };
    },

    async scanTools() {
      try {
        const response = await sendNativeMessage('scan_ai_tools');
        if (Array.isArray(response.tools)) {
          return response.tools as ToolScanResult[];
        }
      } catch {
        // NM helper not available
      }
      return [];
    },

    async checkMcpRegistration(): Promise<McpRegistrationStatus> {
      try {
        const r = await sendNativeMessage('check_mcp_registration');
        return {
          available: true,
          configExists: Boolean(r.configExists),
          configPath: typeof r.configPath === 'string' ? r.configPath : '',
          registered: Boolean(r.registered),
          scope: (r.scope === 'user' || r.scope === 'project') ? r.scope : null,
          binaryPath: typeof r.binaryPath === 'string' ? r.binaryPath : '',
          binaryExists: Boolean(r.binaryExists),
        };
      } catch {
        return {
          available: false,
          configExists: false,
          configPath: '',
          registered: false,
          scope: null,
          binaryPath: '',
          binaryExists: false,
        };
      }
    },

    async repairMcpRegistration(): Promise<McpRegistrationRepairResult> {
      try {
        const r = await sendNativeMessage('repair_mcp_registration');
        return {
          success: Boolean(r.success),
          configPath: typeof r.configPath === 'string' ? r.configPath : '',
          binaryPath: typeof r.binaryPath === 'string' ? r.binaryPath : '',
          scope: 'user',
          backupPath: typeof r.backupPath === 'string' ? r.backupPath : undefined,
          error: typeof r.error === 'string' ? r.error : undefined,
        };
      } catch (err) {
        return {
          success: false,
          configPath: '',
          binaryPath: '',
          scope: 'user',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async getServiceStatus(): Promise<ServiceStatus | null> {
      return fetchServiceStatus(await getBrowserInstanceId());
    },

    async startNativeHost(): Promise<StartNativeHostResult> {
      try {
        const r = await sendNativeMessage('start_native_host');
        return {
          ok: Boolean(r.ok),
          pid: typeof r.pid === 'number' ? r.pid : undefined,
          alreadyRunning: Boolean(r.alreadyRunning),
          error: typeof r.error === 'string' ? r.error : undefined,
          binaryPath: typeof r.binaryPath === 'string' ? r.binaryPath : undefined,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async restartNativeHost(): Promise<StartNativeHostResult> {
      try {
        const r = await sendNativeMessage('restart_native_host');
        return {
          ok: Boolean(r.ok),
          pid: typeof r.pid === 'number' ? r.pid : undefined,
          error: typeof r.error === 'string' ? r.error : undefined,
          binaryPath: typeof r.binaryPath === 'string' ? r.binaryPath : undefined,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

