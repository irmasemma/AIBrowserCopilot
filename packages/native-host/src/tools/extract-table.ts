import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const extractTable: ToolPlugin = {
  name: 'extract_table',
  description: 'Extract structured table data from the page the user is viewing. Use this when the user asks you to read a table, get spreadsheet data, or extract tabular information from a web page.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('CSS selector for a specific table'),
    index: z.number().default(0).describe('Table index if multiple tables exist (default: first)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] extract_table: Not connected to browser.' }] };
  },
};
