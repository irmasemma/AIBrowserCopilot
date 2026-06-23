import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const goBack: ToolPlugin = {
  name: 'go_back',
  description: 'Navigate back in browser history (like clicking the back button). Use this when the user wants to return to a previous page.',
  tier: 'pro',
  inputSchema: {
    wait_until: z.enum(['load', 'domcontentloaded']).optional().default('domcontentloaded').describe('When to consider navigation complete. Default: "domcontentloaded".'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
