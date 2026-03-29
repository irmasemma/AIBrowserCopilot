import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const navigate: ToolPlugin = {
  name: 'navigate',
  description: 'Navigate the active browser tab to a specified URL',
  tier: 'pro',
  inputSchema: {
    url: z.string().describe('Target URL to navigate to'),
    tab_id: z.number().optional().describe('Specific tab ID (defaults to active tab)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] navigate: Not connected to browser.' }] };
  },
};
