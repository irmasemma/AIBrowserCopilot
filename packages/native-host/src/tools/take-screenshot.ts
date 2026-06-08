import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const takeScreenshot: ToolPlugin = {
  name: 'take_screenshot',
  description: 'Take a screenshot of what the user currently sees in their browser. Use this when the user asks you to look at, see, or visually inspect their screen or browser tab.',
  tier: 'free',
  inputSchema: {
    format: z.enum(['png', 'jpeg']).default('png').describe('Image format'),
    quality: z.number().min(0).max(100).default(80).describe('JPEG quality (0-100)'),
    tab_id: z.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>", e.g. "chrome:abc-123:622786441"). Call `list_tabs` first if you do not have one. The tab will be activated automatically.'),
  },
};
