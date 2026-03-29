import { connectToRelay } from '../background/relay-client';
import { dispatchTool } from '../background/tool-dispatcher';

export default defineBackground(() => {
  const handleToolRequest = async (tool: string, params: Record<string, unknown>): Promise<unknown> => {
    return dispatchTool(tool, params);
  };

  try {
    chrome.sidePanel?.setOptions({ enabled: true });
  } catch {
    // sidePanel API may not be available in all contexts
  }

  connectToRelay(handleToolRequest).catch(() => {
    // Relay not available yet — will retry
  });
});
