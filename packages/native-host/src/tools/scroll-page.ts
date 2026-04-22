import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const scrollPage: ToolPlugin = {
  name: 'scroll_page',
  description: 'Scroll the page in a direction, to a CSS selector, or to specific text. Returns scroll position and newly visible content. Use this to read content below the fold, find elements on long pages, or handle infinite scroll.',
  tier: 'pro',
  inputSchema: {
    direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Scroll direction. "up"/"down" scroll by one viewport height. "top"/"bottom" scroll to page extremes.'),
    amount: z.number().optional().describe('Pixels to scroll (overrides direction default of one viewport height). Positive = down, negative = up.'),
    selector: z.string().optional().describe('CSS selector — scroll element into center of viewport.'),
    text: z.string().optional().describe('Find text on page (case-insensitive) and scroll to it.'),
    wait_for_content: z.boolean().optional().default(true).describe('Wait for lazy-loaded content to settle after scroll. Default: true.'),
    tab_id: z.number().optional().describe('Specific tab ID (defaults to active tab)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] scroll_page: Not connected to browser.' }] };
  },
};
