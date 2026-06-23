import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const extractData: ToolPlugin = {
  name: 'extract_data',
  description: 'Extract structured or repeating data from any page — not just HTML tables. Detects card grids, product listings, search results, flex layouts, and classic tables using heuristic pattern detection. Returns the best-matching data region with headers and rows. Use this when the user asks to scrape data, extract listings, or get structured information from a page.',
  tier: 'pro',
  inputSchema: {
    selector: z.string().optional().describe('Optional CSS selector to target a specific container'),
    columns: z.array(z.string()).optional().describe('Optional column name hints to help match the right data region'),
    format: z.enum(['table', 'json']).default('table').describe('Output format (default: table)'),
    max_rows: z.number().default(100).describe('Maximum number of rows to extract (default: 100)'),
    include_links: z.boolean().default(false).describe('Include href URLs in extracted data'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.'),
  },
};
