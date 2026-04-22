chrome.storage.local.get('connectionState', function(data) {
  var state = (data.connectionState && data.connectionState.state) || 'setup-needed';
  var dot = document.getElementById('statusDot');
  var label = document.getElementById('statusLabel');
  if (state === 'connected') { dot.classList.add('connected'); label.textContent = 'Connected'; }
  else if (state === 'disconnected') { label.textContent = 'Disconnected'; }
  else if (state === 'reconnecting') { label.textContent = 'Reconnecting...'; }
  else { label.textContent = 'Setup Required'; }
});
document.getElementById('openPanel').addEventListener('click', function() {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});
