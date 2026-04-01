import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';
import { startRelay, setStartedBy } from './extension-relay.js';

export const VERSION = '0.1.0';

if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// Detect which AI tool started us
const startedByArg = process.argv.find((a) => a.startsWith('--started-by='));

function detectStartedBy(): string {
  if (startedByArg) return startedByArg.split('=')[1];
  if (process.env['COPILOT_STARTED_BY']) return process.env['COPILOT_STARTED_BY'];
  // Auto-detect from known environment variables set by AI tools
  if (process.env['CLAUDECODE'] || process.env['CLAUDE_CODE_ENTRYPOINT']) return 'Claude Code';
  if (process.env['CURSOR_TRACE_ID'] || process.env['CURSOR_CHANNEL']) return 'Cursor';
  if (process.env['VSCODE_PID'] || process.env['TERM_PROGRAM'] === 'vscode') return 'VS Code';
  if (process.env['WINDSURF_SESSION']) return 'Windsurf';
  // Check parent process name via ppid
  try {
    const ppid = process.ppid;
    if (ppid) {
      const { execSync } = require('node:child_process');
      const parentName = execSync(`tasklist /FI "PID eq ${ppid}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 2000 }).toLowerCase();
      if (parentName.includes('claude')) return 'Claude Code';
      if (parentName.includes('code.exe')) return 'VS Code';
      if (parentName.includes('cursor')) return 'Cursor';
      if (parentName.includes('windsurf')) return 'Windsurf';
    }
  } catch {
    // Ignore — parent process detection is best-effort
  }
  return 'unknown';
}

const startedBy = detectStartedBy();
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
