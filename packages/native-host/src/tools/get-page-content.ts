import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageContent: ToolPlugin = {
  name: 'get_page_content',
  description: 'Read the text or HTML content of the web page the user is currently viewing in their browser. Use this when the user asks about what is on their screen, current tab, or current page.',
  tier: 'free',
  inputSchema: {
    format: z.enum(['text', 'html']).default('text').describe('Output format'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
    offset: z.number().int().min(0).optional().describe(
      'Character offset to start reading from (default 0). Every response is capped at ~80,000 characters; ' +
      'when the page has more content than that, the response tells you how many characters remain and what ' +
      'offset to pass to continue reading. Use this to page through long pages (e.g. infinite-scroll feeds) ' +
      'instead of re-reading from the start.',
    ),
    max_chars: z.number().int().min(1).optional().describe(
      'Maximum characters to return in this call (default ~80,000, the same cap every response is subject to). ' +
      'Lower this to request a smaller slice per call.',
    ),
  },
};
