import type { DiagnosticReason } from '../shared/types';

const NM_HELPER_NAME = 'com.copilot.native_host_helper';
const DEFAULT_URL = 'ws://127.0.0.1:7483';

function detectBrowserId(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Vivaldi')) return 'vivaldi';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'opera';
  if (ua.includes('Arc')) return 'arc';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'unknown';
}

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

export interface ServiceDiscovery {
  discoverEndpoint(): Promise<DiscoveryResult>;
  scanTools(): Promise<ToolScanResult[]>;
  checkMcpRegistration(): Promise<McpRegistrationStatus>;
  repairMcpRegistration(): Promise<McpRegistrationRepairResult>;
}

export function createServiceDiscovery(): ServiceDiscovery {
  async function sendNativeMessage(action: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendNativeMessage) {
        chrome.runtime.sendNativeMessage(NM_HELPER_NAME, { action }, (response) => {
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

  return {
    async discoverEndpoint(): Promise<DiscoveryResult> {
      const browserId = detectBrowserId();
      return {
        url: `ws://127.0.0.1:7483?browserId=${browserId}`,
        diagnostic: 'connecting',
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
  };
}
