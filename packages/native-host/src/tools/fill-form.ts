import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const fillForm: ToolPlugin = {
  name: 'fill_form',
  description: 'Fill in form fields on the page the user is viewing. Supports CSS selectors, label text, ARIA roles, and placeholder matching. Handles text inputs, dropdowns, checkboxes, radio buttons, file uploads, and date fields. Can target fields inside iframes. Use this when the user asks you to fill out a form, enter data into fields, or auto-complete form inputs in their browser.',
  tier: 'pro',
  inputSchema: {
    fields: z.array(z.object({
      selector: z.string().optional().describe('CSS selector for the form field'),
      label: z.string().optional().describe('Find field by its label text'),
      role: z.string().optional().describe('Find field by ARIA role'),
      placeholder: z.string().optional().describe('Find field by placeholder text'),
      value: z.string().describe('Value to fill in'),
      type: z.enum(['text', 'select', 'checkbox', 'radio', 'file', 'date']).optional().describe('Field type hint for proper handling'),
    })).describe('Array of form fields to fill'),
    iframe: z.string().optional().describe('CSS selector for iframe to target (for forms inside iframes)'),
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab). The tab will be activated automatically.'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] fill_form: Not connected to browser.' }] };
  },
};
