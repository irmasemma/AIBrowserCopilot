// Processes tool scan results from native host and manages badge notifications

import type { ToolScanResult } from '../shared/types.js';

export interface ToolScanState {
  current: ToolScanResult[];
  previous: ToolScanResult[];
  timestamp: number | null;
}

export function createInitialScanState(): ToolScanState {
  return { current: [], previous: [], timestamp: null };
}

export function getUnconfiguredTools(results: ToolScanResult[]): ToolScanResult[] {
  return results.filter((t) => t.installed && !t.configured);
}

export function getConfiguredTools(results: ToolScanResult[]): ToolScanResult[] {
  return results.filter((t) => t.installed && t.configured);
}

export function getNewUnconfiguredTools(
  current: ToolScanResult[],
  previous: ToolScanResult[],
): ToolScanResult[] {
  const prevSlugs = new Set(
    previous.filter((t) => t.installed && !t.configured).map((t) => t.slug),
  );
  return current.filter(
    (t) => t.installed && !t.configured && !prevSlugs.has(t.slug),
  );
}

export function processScanResults(
  state: ToolScanState,
  newResults: ToolScanResult[],
): ToolScanState {
  return {
    current: newResults,
    previous: state.current,
    timestamp: Date.now(),
  };
}

export async function updateBadge(unconfiguredCount: number, hasConnectionError: boolean): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.action) return;

  if (hasConnectionError) {
    // Connection error badge takes priority
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
  } else if (unconfiguredCount > 0) {
    await chrome.action.setBadgeText({ text: String(unconfiguredCount) });
    await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' }); // amber
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
}
