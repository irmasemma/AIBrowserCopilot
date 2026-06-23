import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const navigate: ToolPlugin = {
  name: 'navigate',
  description: "Navigate the user's browser to a URL. Use this when the user asks you to go to a website, open a page, or navigate somewhere in their browser.",
  tier: 'pro',
  inputSchema: {
    url: z.string().describe('Target URL to navigate to'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
