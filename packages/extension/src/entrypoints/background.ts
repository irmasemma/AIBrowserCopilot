import { connect as connectNative, resetAndConnect } from '../background/native-messaging';
import { dispatchTool } from '../background/tool-dispatcher';

export default defineBackground(() => {
  try {
    chrome.sidePanel?.setOptions({ enabled: true });
  } catch {
    // sidePanel API may not be available in all contexts
  }

  // Try native messaging connection (Chrome spawns the binary)
  connectNative();

  // Listen for retry requests from the setup wizard
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'retry_connection') {
      resetAndConnect();
      sendResponse({ ok: true });
    }
    return false;
  });
});
