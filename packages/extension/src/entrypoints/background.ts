import { connect as connectNative, resetAndConnect as resetNative } from '../background/native-messaging';
import { connectToRelay, resetRelay } from '../background/relay-client';
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

  // connectNative spawns the native host binary (which starts the WebSocket relay on port 7483).
  // connectToRelay connects to that relay for actual tool communication.
  connectNative();
  setTimeout(() => connectToRelay(handleToolRequest).catch(() => {}), 500);

  // Listen for retry requests from the setup wizard
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'retry_connection') {
      // Reset everything and try again — installer may have just finished
      resetNative();
      resetRelay();
      connectNative();
      setTimeout(() => connectToRelay(handleToolRequest).catch(() => {}), 1000);
      sendResponse({ ok: true });
    }
    return false;
  });
});
