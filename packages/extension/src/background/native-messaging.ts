// Native messaging is no longer used to spawn the native host.
// The AI tool (Claude Code, VS Code, Claude Desktop, etc.) manages the native host lifecycle.
// The extension is a pure WebSocket client that connects to port 7483.
//
// This file is kept as a no-op stub so existing imports don't break.

export const connect = (): void => {
  // No-op: extension no longer spawns the native host
};

export const resetAndConnect = (): void => {
  // No-op
};

export const isConnected = (): boolean => false;
