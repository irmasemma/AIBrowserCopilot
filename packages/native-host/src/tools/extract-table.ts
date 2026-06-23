import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const extractTable: ToolPlugin = {
  name: 'extract_table',
  description: 'Extract structured table data from the page the user is viewing. Use this when the user asks you to read a table, get spreadsheet data, or extract tabular information from a web page.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('CSS selector for a specific table'),
    index: z.number().default(0).describe('Table index if multiple tables exist (default: first)'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
