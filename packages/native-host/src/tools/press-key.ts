import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const pressKey: ToolPlugin = {
  name: 'press_key',
  description: 'Press a keyboard key, optionally focused on a specific element. Use this to submit forms (key="Enter" with the last input\'s ref), dismiss dialogs (key="Escape"), navigate (key="Tab", "ArrowDown", "PageDown"), or trigger keyboard shortcuts. Prefer `ref` from the page snapshot to focus a specific element first; omit ref/selector to send the keystroke at the page level.',
  tier: 'pro',
  inputSchema: {
    key: z.string().describe('Key name (Playwright syntax): "Enter", "Escape", "Tab", "Backspace", "ArrowDown", "PageDown", "Control+a", etc.'),
    ref: z.string().optional().describe('PREFERRED: ref ID of the element to focus before pressing (from snapshot, e.g., "e3").'),
    selector: z.string().optional().describe('CSS selector of the element to focus before pressing.'),
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab).'),
  },
};
