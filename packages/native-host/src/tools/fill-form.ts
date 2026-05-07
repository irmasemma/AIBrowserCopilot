import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const fillForm: ToolPlugin = {
  name: 'fill_form',
  description: 'Fill in form fields on the page the user is viewing. Prefer the `ref` field on each entry — call `snapshot` first and use the [ref=eN] IDs from the result; refs are unambiguous and work across iframes. Other locators (label, role+name, placeholder, selector) are supported as fallbacks. Element type (text/select/checkbox/radio/file) is auto-detected from the DOM unless you set `type` explicitly. For checkboxes use `checked: true|false`. For multi-select use `values: [...]`. role-only is rejected — always pair with `name`. Use this when the user asks you to fill out a form, enter data into fields, or auto-complete form inputs in their browser.',
  tier: 'pro',
  inputSchema: {
    fields: z.array(z.object({
      ref: z.string().optional().describe('PREFERRED: ref ID from the page snapshot (e.g., "e3"). Unambiguous; works across iframes.'),
      selector: z.string().optional().describe('CSS selector for the form field'),
      label: z.string().optional().describe('Find field by its label text'),
      role: z.string().optional().describe('ARIA role (e.g., "textbox"). Must be paired with `name` — role-only is rejected.'),
      name: z.string().optional().describe('Accessible name to combine with `role` (e.g., role: "textbox", name: "Email")'),
      placeholder: z.string().optional().describe('Find field by placeholder text'),
      value: z.string().optional().describe('Value to fill in for text inputs, single-select, file paths'),
      values: z.array(z.string()).optional().describe('For multi-select: list of option values. For file inputs: list of file paths.'),
      checked: z.boolean().optional().describe('For checkboxes/switches: explicit checked state. Preferred over passing "true"/"false" strings via `value`.'),
      type: z.enum(['text', 'select', 'checkbox', 'radio', 'file', 'date']).optional().describe('Override type detection. Usually unnecessary — type is auto-detected from the DOM.'),
    })).describe('Array of form fields to fill. Each field: provide `ref` (preferred) or one of label/role+name/placeholder/selector, plus `value` (or `values`/`checked`).'),
    iframe: z.string().optional().describe('CSS selector for iframe to target. Used only with non-ref locators (refs work across iframes automatically).'),
    tab_id: z.number().optional().describe('Specific tab ID to target (defaults to active tab). The tab will be activated automatically.'),
  },
};
