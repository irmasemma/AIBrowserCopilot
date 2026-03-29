import { z } from 'zod';
import type { ToolPlugin } from '../shared/types.js';

export const takeScreenshot: ToolPlugin = {
  name: 'take_screenshot',
  description: 'Capture a screenshot of the visible browser tab',
  tier: 'free',
  inputSchema: {
    format: z.enum(['png', 'jpeg']).default('png').describe('Image format'),
    quality: z.number().min(0).max(100).default(80).describe('JPEG quality (0-100)'),
  },
  async execute() {
    return { content: [{ type: 'text' as const, text: '[Stub] take_screenshot: Not connected to browser.' }] };
  },
};
