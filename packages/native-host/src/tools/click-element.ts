import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const clickElement: ToolPlugin = {
  name: 'click_element',
  description: 'Click a button, link, or other element on the page the user is viewing. Prefer `ref` from the page snapshot for unambiguous targeting. Falls back to visible text or a CSS selector. Use this when the user asks you to click something, press a button, or interact with an element in their browser.',
  tier: 'pro',
  inputSchema: {
    ref: z.string().optional().describe('PREFERRED: ref ID from the page snapshot (e.g., "e7"). Unambiguous and stable.'),
    selector: z.string().optional().describe('CSS selector for the element'),
    text: z.string().optional().describe('Visible text of the button or link to click. Prefers clickable elements (buttons, links) over plain text.'),
    index: z.number().optional().default(0).describe('Which match to click when multiple elements match (0 = first). Use when there are duplicate buttons.'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
