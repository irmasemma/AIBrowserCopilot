type SetupEvent =
  | 'setup_started'
  | 'bridge_download_started'
  | 'bridge_download_complete'
  | 'os_dialog_shown'
  | 'bridge_registered'
  | 'ai_host_detected'
  | 'first_connection';

export const trackSetupEvent = async (event: SetupEvent, details?: Record<string, unknown>): Promise<void> => {
  const data = await chrome.storage.local.get('setupEvents');
  const events: Array<{ event: string; timestamp: number; details?: Record<string, unknown> }> = data.setupEvents ?? [];

  events.push({
    event,
    timestamp: Date.now(),
    details,
  });

  await chrome.storage.local.set({ setupEvents: events });
};
