import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageMetadata: ToolPlugin = {
  name: 'get_page_metadata',
  description: 'Get metadata (title, URL, description, Open Graph tags, favicon) from the page the user is viewing. Use this when you need a quick summary of what a page is about without reading the full content.',
  tier: 'pro',
  inputSchema: {
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
