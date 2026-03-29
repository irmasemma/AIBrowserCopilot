import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const clickElement: ToolPlugin = {
  name: 'click_element',
  description: 'Click an element on the active browser tab by CSS selector or visible text',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('CSS selector for the element'),
    text: z.string().optional().describe('Visible text content to match'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] click_element: Not connected to browser.' }] };
  },
};
