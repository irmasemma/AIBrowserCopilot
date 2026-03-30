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
    case 'disconnected':
      dot.style.background = '#EF4444';
      label.textContent = 'Disconnected';
      break;
    case 'reconnecting':
      dot.style.background = '#F59E0B';
      label.textContent = 'Reconnecting...';
      break;
    default:
      dot.style.background = '#9CA3AF';
      label.textContent = 'Setup Required';
  }
};

// Initial read
chrome.storage.local.get('connectionState', (data: Record<string, unknown>) => {
  const state = (data.connectionState as { state?: string } | undefined)?.state ?? 'setup-needed';
  updateStatus(state);
});

// Listen for changes so popup stays in sync
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connectionState?.newValue) {
    updateStatus(changes.connectionState.newValue.state ?? 'setup-needed');
  }
});
