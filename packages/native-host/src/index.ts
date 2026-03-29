import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { startRelay } from './extension-relay.js';

const main = async () => {
  const port = await startRelay();
  process.stderr.write(`Extension relay listening on 127.0.0.1:${port}\n`);

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error: unknown) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
