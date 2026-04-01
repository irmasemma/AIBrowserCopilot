import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageContent: ToolPlugin = {
  name: 'get_page_content',
  description: 'Read the text or HTML content of the web page the user is currently viewing in their browser. Use this when the user asks about what is on their screen, current tab, or current page.',
  tier: 'free',
  inputSchema: {
    url: z.string().optional().describe('Target URL (defaults to active tab)'),
    format: z.enum(['text', 'html']).default('text').describe('Output format'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] get_page_content: Not connected to browser. Browser bridge will be added in Story 1.3.' }] };
  },
};
