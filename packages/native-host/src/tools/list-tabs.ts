import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const listTabs: ToolPlugin = {
  name: 'list_tabs',
  description: 'List all tabs the user has open in their browser with titles and URLs. Use this when the user asks what tabs they have open, or needs help finding or organizing tabs.',
  tier: 'free',
  inputSchema: {
    query: z.string().optional().describe('Filter tabs by title or URL match'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] list_tabs: Not connected to browser.' }] };
  },
};
