import { create } from 'zustand';
import type { ConnectionInfo, ActivityEntry } from '../shared/types.js';

interface AppState {
  connection: ConnectionInfo;
  activityLog: ActivityEntry[];
  toolPermissions: Record<string, boolean>;
  setConnection: (info: ConnectionInfo) => void;
  addActivity: (entry: ActivityEntry) => void;
  setActivityLog: (log: ActivityEntry[]) => void;
  toggleTool: (tool: string) => void;
  setToolPermissions: (permissions: Record<string, boolean>) => void;
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

export const useStore = create<AppState>((set) => ({
  connection: { state: 'setup-needed', lastConnected: null, error: null },
  activityLog: [],
  toolPermissions: { ...DEFAULT_PERMISSIONS },

  setConnection: (info) => set({ connection: info }),

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
}));

// Sync from chrome.storage on load
export const initStoreFromStorage = async (): Promise<void> => {
  const data = await chrome.storage.local.get(['connectionState', 'activityLog', 'toolPermissions']);

  if (data.connectionState) {
    useStore.getState().setConnection(data.connectionState as ConnectionInfo);
  }
  if (data.activityLog) {
    useStore.getState().setActivityLog(data.activityLog as ActivityEntry[]);
  }
  if (data.toolPermissions) {
    useStore.getState().setToolPermissions(data.toolPermissions as Record<string, boolean>);
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
  });
};
