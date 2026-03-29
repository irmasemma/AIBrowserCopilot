import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ToolContext {
  tabId: number;
  sendToTab: (script: string) => Promise<unknown>;
}

export type ToolResult = CallToolResult;

export interface ToolPlugin {
  name: string;
  description: string;
  tier: 'free' | 'pro';
  inputSchema: Record<string, z.ZodTypeAny>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}
