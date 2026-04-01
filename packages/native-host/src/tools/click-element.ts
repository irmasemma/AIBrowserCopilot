import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const clickElement: ToolPlugin = {
  name: 'click_element',
  description: 'Click a button, link, or other element on the page the user is viewing. Use this when the user asks you to click something, press a button, or interact with an element in their browser.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('CSS selector for the element'),
    text: z.string().optional().describe('Visible text content to match'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] click_element: Not connected to browser.' }] };
  },
};
