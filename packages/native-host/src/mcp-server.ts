import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from './tools/index.js';
import { sendToExtension, isExtensionConnected, waitForExtensionConnection } from './extension-relay.js';
import type { ToolPlugin } from './shared/types.js';

export const createMcpServer = (): McpServer => {
  const server = new McpServer({
    name: 'ai-browser-copilot',
    version: '0.1.0',
  });

  for (const tool of toolRegistry) {
    registerTool(server, tool);
  }

  return server;
};

const textResult = (text: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

const registerTool = (server: McpServer, tool: ToolPlugin): void => {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (params): Promise<CallToolResult> => {
      // AD-17: If extension isn't connected, wait up to 35s for it to reconnect
      if (!isExtensionConnected()) {
        const connected = await waitForExtensionConnection();
        if (!connected) {
          return textResult(
            'Browser extension did not connect within 35 seconds. '
            + 'Please check the extension is installed and enabled.',
            true,
          );
        }
      }

      try {
        const response = await sendToExtension({
          id: randomUUID(),
          tool: tool.name,
          params: params as Record<string, unknown>,
        });

        if (response.error) {
          return textResult(JSON.stringify(response.error), true);
        }

        return (response.result as CallToolResult) ?? textResult('No result returned');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return textResult(`Tool execution failed: ${message}`, true);
      }
    },
  );
};
