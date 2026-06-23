import { z } from 'zod';

export interface ToolPlugin {
  name: string;
  description: string;
  tier: 'free' | 'pro';
  inputSchema: Record<string, z.ZodTypeAny>;
}
