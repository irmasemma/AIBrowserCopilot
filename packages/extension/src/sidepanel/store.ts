import { create } from 'zustand';
import type { ConnectionInfo, ConnectionContext, ActivityEntry, ToolScanResult } from '../shared/types.js';

interface AppState {
  /** @deprecated Use connectionContext instead */
  connection: ConnectionInfo;
  connectionContext: ConnectionContext;
  activityLog: ActivityEntry[];
  toolPermissions: Record<string, boolean>;
  toolScanResults: ToolScanResult[];
  toolScanTimestamp: number | null;
  setConnection: (info: ConnectionInfo) => void;
  setConnectionContext: (ctx: ConnectionContext) => void;
  addActivity: (entry: ActivityEntry) => void;
  setActivityLog: (log: ActivityEntry[]) => void;
  toggleTool: (tool: string) => void;
  setToolPermissions: (permissions: Record<string, boolean>) => void;
  setToolScanResults: (results: ToolScanResult[]) => void;
}

const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  get_page_content: true,
  take_screenshot: true,
  list_tabs: true,
  get_page_metadata: true,
  navigate: true,
  fill_form: true,
  click_element: true,
  extract_table: true,
};

const DEFAULT_CONNECTION_CONTEXT: ConnectionContext = {
  state: 'disconnected',
  failureCount: 0,
  missedHeartbeats: 0,
  lastConnectedAt: null,
  serverInfo: null,
  error: null,
  reconnectsThisSession: 0,
};

export const useStore = create<AppState>((set) => ({
  connection: { state: 'disconnected', lastConnected: null, error: null },
  connectionContext: { ...DEFAULT_CONNECTION_CONTEXT },
  activityLog: [],
  toolPermissions: { ...DEFAULT_PERMISSIONS },
  toolScanResults: [],
  toolScanTimestamp: null,

  setConnection: (info) => set({ connection: info }),

  setConnectionContext: (ctx) => set({ connectionContext: ctx }),

  addActivity: (entry) =>
    set((state) => ({
      activityLog: [entry, ...state.activityLog].slice(0, 500),
    })),

  setActivityLog: (log) => set({ activityLog: log }),

  toggleTool: (tool) =>
    set((state) => {
      const permissions = { ...state.toolPermissions, [tool]: !state.toolPermissions[tool] };
      chrome.storage.local.set({ toolPermissions: permissions });
      return { toolPermissions: permissions };
    }),

  setToolPermissions: (permissions) => set({ toolPermissions: permissions }),

  setToolScanResults: (results) => set({ toolScanResults: results, toolScanTimestamp: Date.now() }),
}));

// Sync from chrome.storage on load
export const initStoreFromStorage = async (): Promise<void> => {
  const data = await chrome.storage.local.get([
    'connectionState',
    'connectionContext',
    'activityLog',
    'toolPermissions',
    'toolScanResults',
  ]);

  if (data.connectionState) {
    useStore.getState().setConnection(data.connectionState as ConnectionInfo);
  }
  if (data.connectionContext) {
    useStore.getState().setConnectionContext(data.connectionContext as ConnectionContext);
  }
  if (data.activityLog) {
    useStore.getState().setActivityLog(data.activityLog as ActivityEntry[]);
  }
  if (data.toolPermissions) {
    useStore.getState().setToolPermissions(data.toolPermissions as Record<string, boolean>);
  }
  if (data.toolScanResults) {
    useStore.getState().setToolScanResults(data.toolScanResults as ToolScanResult[]);
  }
};

// Listen for real-time updates from service worker
export const listenForUpdates = (): void => {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'activity_update' && message.entry) {
      useStore.getState().addActivity(message.entry as ActivityEntry);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.connectionState?.newValue) {
      useStore.getState().setConnection(changes.connectionState.newValue as ConnectionInfo);
    }
    if (changes.connectionContext?.newValue) {
      useStore.getState().setConnectionContext(changes.connectionContext.newValue as ConnectionContext);
    }
    if (changes.toolScanResults?.newValue) {
      useStore.getState().setToolScanResults(changes.toolScanResults.newValue as ToolScanResult[]);
    }
  });
};
