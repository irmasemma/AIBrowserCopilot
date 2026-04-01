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

const app = document.getElementById('app')!;
app.appendChild(statusRow);
app.appendChild(btn);

const updateStatus = (state: string) => {
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
      label.textContent = 'Reconnecting...';
      break;
    case 'disconnected':
      dot.style.background = '#9CA3AF';
      label.textContent = 'Not Connected';
      break;
    default:
      dot.style.background = '#9CA3AF';
      label.textContent = 'Not Connected';
  }
};

// Read from connectionContext (new key) with fallback to connectionState (old key)
chrome.storage.local.get(['connectionContext', 'connectionState'], (data: Record<string, unknown>) => {
  const ctx = data.connectionContext as { state?: string } | undefined;
  const old = data.connectionState as { state?: string } | undefined;
  const state = ctx?.state ?? old?.state ?? 'disconnected';
  updateStatus(state);
});

// Listen for changes on both keys
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connectionContext?.newValue) {
    updateStatus(changes.connectionContext.newValue.state ?? 'disconnected');
  } else if (changes.connectionState?.newValue) {
    updateStatus(changes.connectionState.newValue.state ?? 'disconnected');
  }
});
