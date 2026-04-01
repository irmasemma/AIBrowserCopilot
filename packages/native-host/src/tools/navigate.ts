import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const navigate: ToolPlugin = {
  name: 'navigate',
  description: "Navigate the user's browser to a URL. Use this when the user asks you to go to a website, open a page, or navigate somewhere in their browser.",
  tier: 'pro',
  inputSchema: {
    url: z.string().describe('Target URL to navigate to'),
    tab_id: z.number().optional().describe('Specific tab ID (defaults to active tab)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] navigate: Not connected to browser.' }] };
  },
};
