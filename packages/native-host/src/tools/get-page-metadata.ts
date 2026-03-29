import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageMetadata: ToolPlugin = {
  name: 'get_page_metadata',
  description: 'Get metadata (title, URL, description, Open Graph, favicon) from the active tab',
  tier: 'pro',
  inputSchema: {
    url: z.string().optional().describe('Target URL (defaults to active tab)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] get_page_metadata: Not connected to browser.' }] };
  },
};
