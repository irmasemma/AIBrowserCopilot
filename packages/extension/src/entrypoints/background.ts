import { createConnectionManager } from '../background/connection-manager';
import { createServiceDiscovery } from '../background/service-discovery';
import { dispatchTool } from '../background/tool-dispatcher';
import {
  processScanResults,
  createInitialScanState,
  getUnconfiguredTools,
  updateBadge,
} from '../background/tool-scanner';
import type { ToolScanResult } from '../shared/types';

export default defineBackground(() => {
  let scanState = createInitialScanState();
  const discovery = createServiceDiscovery();

  const manager = createConnectionManager({
    discoverUrl: () => discovery.discoverEndpoint(),
    onToolRequest(id, tool, params) {
      dispatchTool(tool, params)
        .then((result) => {
          manager.getRelay()?.sendToolResponse(id, result);
          // Track last tool call
          chrome.storage.local.get('connectionContext', (stored) => {
            if (stored.connectionContext) {
              chrome.storage.local.set({
                connectionContext: { ...stored.connectionContext, lastToolCall: Date.now() },
              });
            }
          });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Unknown error';
          const code = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
          manager.getRelay()?.sendToolError(id, { message, code });
        });
    },

    onToolScan(tools: ToolScanResult[]) {
      scanState = processScanResults(scanState, tools);
      chrome.storage.local.set({
        toolScanResults: scanState.current,
        toolScanTimestamp: scanState.timestamp,
      });
      const unconfigured = getUnconfiguredTools(tools);
      const ctx = manager.getContext();
      updateBadge(unconfigured.length, ctx.state === 'degraded');
    },
  });

  // Update badge on connection state changes
  manager.onStateChange((ctx) => {
    const unconfigured = getUnconfiguredTools(scanState.current);
    updateBadge(unconfigured.length, ctx.state === 'degraded');
  });

  try {
    chrome.sidePanel?.setOptions({ enabled: true });
  } catch {
    // sidePanel API may not be available in all contexts
  }

  // Discover endpoint and connect
  async function startConnection() {
    try {
      const { url } = await discovery.discoverEndpoint();
      await manager.connect(url);
    } catch {
      // Fall back to default
      await manager.connect();
    }
  }

  startConnection();

  // Listen for retry/reconnect requests from UI
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'retry_connection' || message?.type === 'reconnect') {
      manager.retry();
      sendResponse({ ok: true });
    }
    return false;
  });
});
