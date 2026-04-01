import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const fillForm: ToolPlugin = {
  name: 'fill_form',
  description: 'Fill in form fields on the page the user is viewing. Use this when the user asks you to fill out a form, enter data into fields, or auto-complete form inputs in their browser.',
  tier: 'pro',
  inputSchema: {
    fields: z.array(z.object({
      selector: z.string().describe('CSS selector for the form field'),
      value: z.string().describe('Value to fill in'),
    })).describe('Array of form fields to fill'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] fill_form: Not connected to browser.' }] };
  },
};
