import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const readForm: ToolPlugin = {
  name: 'read_form',
  description: 'Read all form fields on the page the user is viewing. Returns structured metadata about every input, select, textarea, and contenteditable field — including labels, types, current values, and options. Use this before fill_form to understand what fields exist and how to target them.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('Optional CSS selector to target a specific form'),
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab). The tab will be activated automatically.'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] read_form: Not connected to browser.' }] };
  },
};
