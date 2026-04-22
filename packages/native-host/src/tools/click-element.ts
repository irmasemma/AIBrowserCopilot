import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const clickElement: ToolPlugin = {
  name: 'click_element',
  description: 'Click a button, link, or other element on the page the user is viewing. Use this when the user asks you to click something, press a button, or interact with an element in their browser.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('CSS selector for the element'),
    text: z.string().optional().describe('Visible text of the button or link to click. Prefers clickable elements (buttons, links) over plain text.'),
    index: z.number().optional().default(0).describe('Which match to click when multiple elements match (0 = first). Use when there are duplicate buttons.'),
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab). The tab will be activated automatically.'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] click_element: Not connected to browser.' }] };
  },
};
