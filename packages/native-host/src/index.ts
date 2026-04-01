import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { startRelay, setStartedBy } from './extension-relay.js';

export const VERSION = '0.1.0';

if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Detect which AI tool started us (passed via MCP config args or env)
const startedByArg = process.argv.find((a) => a.startsWith('--started-by='));
const startedBy = startedByArg?.split('=')[1] ?? process.env['COPILOT_STARTED_BY'] ?? 'unknown';
setStartedBy(startedBy);

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
