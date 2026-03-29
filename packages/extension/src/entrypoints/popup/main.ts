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

chrome.storage.local.get('connectionState', (data: Record<string, unknown>) => {
  const state = (data.connectionState as { state?: string } | undefined)?.state ?? 'setup-needed';
  switch (state) {
    case 'connected':
      dot.style.background = '#16A34A';
      label.textContent = 'Connected';
      break;
    case 'disconnected':
      label.textContent = 'Disconnected';
      break;
    case 'reconnecting':
      label.textContent = 'Reconnecting...';
      break;
    default:
      label.textContent = 'Setup Required';
  }
});
