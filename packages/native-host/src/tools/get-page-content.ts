import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageContent: ToolPlugin = {
  name: 'get_page_content',
  description: 'Read the text or HTML content of the web page the user is currently viewing in their browser. Use this when the user asks about what is on their screen, current tab, or current page.',
  tier: 'free',
  inputSchema: {
    format: z.enum(['text', 'html']).default('text').describe('Output format'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
