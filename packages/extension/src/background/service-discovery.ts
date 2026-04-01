import type { DiagnosticReason } from '../shared/types';

const NM_HELPER_NAME = 'com.copilot.native_host_helper';
const DEFAULT_URL = 'ws://127.0.0.1:7483';

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

export interface ServiceDiscovery {
  discoverEndpoint(): Promise<DiscoveryResult>;
  scanTools(): Promise<ToolScanResult[]>;
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
      try {
        const response = await sendNativeMessage('read_lock_file');
        if (response.exists && response.port) {
          const port = response.port as number;
          const token = response.token as string | undefined;
          const url = `ws://127.0.0.1:${port}${token ? `?token=${token}` : ''}`;
          return { url, token, diagnostic: 'connecting' };
        }
        // Helper works but no lock file — server not running
        return { url: DEFAULT_URL, diagnostic: 'no_lock_file' };
      } catch {
        // Helper not available — setup incomplete
        return { url: DEFAULT_URL, diagnostic: 'helper_unavailable' };
      }
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
  };
}
