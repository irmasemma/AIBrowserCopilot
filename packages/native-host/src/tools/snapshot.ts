import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const snapshot: ToolPlugin = {
  name: 'snapshot',
  description: "Capture an accessibility snapshot of the current page. Returns a YAML tree of all interactive elements (buttons, links, inputs, forms) with their roles, labels, and states (checked, disabled, required, invalid). Use this to understand the page structure before interacting, or to see what changed after an action.",
  tier: 'free',
  inputSchema: {
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab)'),
  },
};
