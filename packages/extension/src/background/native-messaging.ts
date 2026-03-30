import { NATIVE_HOST_NAME } from '../shared/constants.js';

// Native messaging is used ONLY to spawn the native host binary.
// Actual communication happens via the WebSocket relay client.
// This module does NOT manage connectionState — the relay client does.

let port: chrome.runtime.Port | null = null;

export const connect = (): void => {
  if (port) return;

  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    port.onDisconnect.addListener(() => {
      port = null;
      // Binary exited — will be respawned on next connect() call
    });
  } catch {
    // Native host not registered — relay client will handle the state
  }
};

export const resetAndConnect = (): void => {
  port = null;
  connect();
};

export const isConnected = (): boolean => port !== null;
