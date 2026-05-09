import type { DiagnosticReason } from '../shared/types';
import { getBrowserInstanceId } from '../shared/browser-instance-id';

const NM_HELPER_NAME = 'com.copilot.native_host_helper';
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
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendNativeMessage) {
        chrome.runtime.sendNativeMessage(NM_HELPER_NAME, { action, ...extra }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response as Record<string, unknown>);
          }
        });
      } else {
        reject(new Error('Native messaging not available'));
      }
    });
  }

  async function fetchServiceStatus(browserId: string): Promise<ServiceStatus | null> {
    try {
      const r = await sendNativeMessage('get_service_status', { browserId });
      // Defensive: validate the shape minimally.
      if (typeof r.reason !== 'string' || typeof r.url !== 'string') return null;
      return r as unknown as ServiceStatus;
    } catch {
      return null;
    }
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

