/**
 * Drive Anthropic's Claude Code CLI in --print/stream-json mode and assert
 * that an `pilotwave` MCP tool was invoked with a real result.
 *
 * Usage assumes `claude` is on PATH and the user is logged in (sk-ant-oat OAuth
 * token under ~/.claude/.credentials.json). The installer is expected to have
 * registered the pilotwave MCP server before this runs — verify with
 * `claude mcp list` if assertions fail.
 */
import { spawn } from 'node:child_process';

const MCP_TOOL_LIST_TABS = 'mcp__pilotwave__list_tabs';

export interface ToolUseEvent {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolUseId: string;
  isError: boolean;
  /** Concatenated text from all content blocks in the result. */
  text: string;
}

export interface ClaudeRunResult {
  exitCode: number | null;
  toolUses: ToolUseEvent[];
  toolResults: ToolResultEvent[];
  finalText: string;
  rawLines: string[];
  stderr: string;
}

interface StreamJsonAssistantContent {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface StreamJsonUserContent {
  type: 'tool_result';
  tool_use_id?: string;
  is_error?: boolean;
  content?: Array<{ type: string; text?: string }> | string;
}

const collectText = (
  content: StreamJsonUserContent['content'] | undefined,
): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((c) => (typeof c.text === 'string' ? c.text : ''))
    .filter((t) => t.length > 0)
    .join('\n');
};

export const runClaudePrompt = async (
  prompt: string,
  { timeoutMs = 120_000, model = 'haiku' }: { timeoutMs?: number; model?: string } = {},
): Promise<ClaudeRunResult> => {
  return new Promise((resolve, reject) => {
    // Pass the prompt via stdin, not as an arg, so shell quoting can't mangle
    // unicode or quotes. --input-format text means stdin replaces the [prompt]
    // positional. Pair it with --print so claude exits after the response.
    const args = [
      '--print',
      '--input-format',
      'text',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--allowedTools',
      MCP_TOOL_LIST_TABS,
      '--dangerously-skip-permissions',
    ];
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });
    child.stdin?.end(prompt);

    const rawLines: string[] = [];
    const toolUses: ToolUseEvent[] = [];
    const toolResults: ToolResultEvent[] = [];
    let finalText = '';
    let stderr = '';
    let stdoutBuf = '';

    const handleEvent = (raw: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      const type = event.type as string | undefined;
      if (type === 'assistant') {
        const message = event.message as { content?: StreamJsonAssistantContent[] } | undefined;
        for (const c of message?.content ?? []) {
          if (c.type === 'tool_use' && c.name && c.id) {
            toolUses.push({
              toolName: c.name,
              toolUseId: c.id,
              input: c.input ?? {},
            });
          } else if (c.type === 'text' && c.text) {
            finalText += c.text;
          }
        }
      } else if (type === 'user') {
        const message = event.message as { content?: StreamJsonUserContent[] } | undefined;
        for (const c of message?.content ?? []) {
          if (c.type === 'tool_result' && c.tool_use_id) {
            toolResults.push({
              toolUseId: c.tool_use_id,
              isError: Boolean(c.is_error),
              text: collectText(c.content),
            });
          }
        }
      } else if (type === 'result') {
        const r = event.result;
        if (typeof r === 'string') finalText = r;
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line.length > 0) {
          rawLines.push(line);
          handleEvent(line);
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `claude -p timed out after ${timeoutMs}ms.\n` +
            `Captured ${toolUses.length} tool_use, ${toolResults.length} tool_result.\n` +
            `stderr (first 500 chars): ${stderr.slice(0, 500)}`,
        ),
      );
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (stdoutBuf.trim().length > 0) {
        rawLines.push(stdoutBuf.trim());
        handleEvent(stdoutBuf.trim());
      }
      resolve({ exitCode: code, toolUses, toolResults, finalText, rawLines, stderr });
    });
  });
};

export interface ListTabsTab {
  id: string | number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
}

/**
 * Parse the text payload of an pilotwave list_tabs tool_result. The
 * MCP tool returns shapes seen in practice:
 *   - `{ "tabs": [...] }`                 (current bridge serialisation)
 *   - `[...]`                              (bare array, in case shape changes)
 *   - `{ "content": [{ "text": "<JSON>" }] }` (raw MCP envelope, defensive)
 * Tolerant of leading/trailing whitespace.
 */
export const parseListTabsResult = (text: string): ListTabsTab[] => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('list_tabs tool_result text was empty');
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (Array.isArray(parsed)) return parsed as ListTabsTab[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.tabs)) return obj.tabs as ListTabsTab[];
    if (Array.isArray(obj.content)) {
      const block = obj.content.find(
        (c): c is { type: string; text: string } =>
          typeof c === 'object' && c !== null && typeof (c as { text?: unknown }).text === 'string',
      );
      if (block) return parseListTabsResult(block.text);
    }
  }
  throw new Error(`Unexpected list_tabs result shape: ${trimmed.slice(0, 200)}`);
};

export const findListTabsCall = (
  result: ClaudeRunResult,
): { use: ToolUseEvent; res: ToolResultEvent } | null => {
  const use = result.toolUses.find((t) => t.toolName === MCP_TOOL_LIST_TABS);
  if (!use) return null;
  const res = result.toolResults.find((r) => r.toolUseId === use.toolUseId);
  if (!res) return null;
  return { use, res };
};
