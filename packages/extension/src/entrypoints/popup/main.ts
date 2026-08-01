const dot = document.createElement('span');
dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#9CA3AF;display:inline-block';

const label = document.createElement('span');
label.style.cssText = 'font-weight:500;color:#374151;font-size:13px';
label.textContent = 'Checking...';

const statusRow = document.createElement('div');
statusRow.style.cssText = 'display:flex;align-items:center;gap:8px';
statusRow.appendChild(dot);
statusRow.appendChild(label);

const btn = document.createElement('button');
btn.textContent = 'Open Side Panel';
btn.style.cssText = 'display:block;margin-top:8px;width:100%;padding:6px;background:#2563EB;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer';
btn.addEventListener('click', () => {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});

// Connection status is HIDDEN in the popup for now (not removed). The popup is
// not tab-scoped, and connection/MCP status now lives in the side panel's MCP
// tab; showing it here duplicated a signal that isn't relevant to every surface.
// The status element and its live-update wiring below are kept intact — flip
// this flag back to true to restore the popup indicator.
const SHOW_CONNECTION_STATUS = false;

const app = document.getElementById('app')!;
if (SHOW_CONNECTION_STATUS) app.appendChild(statusRow);
app.appendChild(btn);

const getDiagnosticLabel = (reason?: string): string => {
  switch (reason) {
    case 'was_connected': return 'Lost connection \u2014 reopen your AI tool';
    case 'no_lock_file': return 'No AI tool running \u2014 open one to connect';
    case 'helper_unavailable': return 'Setup incomplete \u2014 run installer';
    case 'server_not_responding': return 'Server not responding \u2014 restart AI tool';
    default: return 'Looking for AI tool...';
  }
};

const updateStatus = (state: string, diagnosticReason?: string) => {
  switch (state) {
    case 'connected':
      dot.style.background = '#16A34A';
      label.textContent = 'Connected';
      break;
    case 'connecting':
      dot.style.background = '#F59E0B';
      label.textContent = 'Connecting...';
      break;
    case 'degraded':
      dot.style.background = '#F59E0B';
      label.textContent = 'Unstable';
      break;
    case 'reconnecting':
      dot.style.background = '#F59E0B';
      label.textContent = getDiagnosticLabel(diagnosticReason);
      break;
    case 'disconnected':
      dot.style.background = '#9CA3AF';
      label.textContent = diagnosticReason ? getDiagnosticLabel(diagnosticReason) : 'Not Connected';
      break;
    default:
      dot.style.background = '#9CA3AF';
      label.textContent = 'Not Connected';
  }
};

// Read from connectionContext (new key) with fallback to connectionState (old key)
chrome.storage.local.get(['connectionContext', 'connectionState'], (data: Record<string, unknown>) => {
  const ctx = data.connectionContext as { state?: string; diagnosticReason?: string } | undefined;
  const old = data.connectionState as { state?: string } | undefined;
  const state = ctx?.state ?? old?.state ?? 'disconnected';
  updateStatus(state, ctx?.diagnosticReason);
});

// Listen for changes on both keys
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connectionContext?.newValue) {
    const ctx = changes.connectionContext.newValue;
    updateStatus(ctx.state ?? 'disconnected', ctx.diagnosticReason);
  } else if (changes.connectionState?.newValue) {
    updateStatus(changes.connectionState.newValue.state ?? 'disconnected');
  }
});

// Marks this side-effect entrypoint as an ES module (no runtime effect) so it
// can be side-effect-imported from the popup unit test under NodeNext.
export {};
