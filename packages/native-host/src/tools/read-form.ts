import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const readForm: ToolPlugin = {
  name: 'read_form',
  description: 'Read all form fields on the page the user is viewing. Returns structured metadata about every input, select, textarea, and contenteditable field — including labels, types, current values, and options. Use this before fill_form to understand what fields exist and how to target them.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('Optional CSS selector to target a specific form'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
