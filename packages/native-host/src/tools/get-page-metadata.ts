import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const getPageMetadata: ToolPlugin = {
  name: 'get_page_metadata',
  description: 'Get metadata (title, URL, description, Open Graph tags, favicon) from the page the user is viewing. Use this when you need a quick summary of what a page is about without reading the full content.',
  tier: 'pro',
  inputSchema: {
    url: z.string().optional().describe('Target URL (defaults to active tab)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] get_page_metadata: Not connected to browser.' }] };
  },
};
