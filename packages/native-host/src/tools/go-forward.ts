import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const goForward: ToolPlugin = {
  name: 'go_forward',
  description: 'Navigate forward in browser history. Use this after going back to return to where you were.',
  tier: 'pro',
  inputSchema: {
    wait_until: z.enum(['load', 'domcontentloaded']).optional().default('domcontentloaded').describe('When to consider navigation complete. Default: "domcontentloaded".'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
