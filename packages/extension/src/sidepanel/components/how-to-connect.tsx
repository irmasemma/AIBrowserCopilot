import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';

interface ToolGuide {
  name: string;
  blurb: string;
  command: string;
  docsUrl?: string;
}

const INSTALL_BASE = 'npx agenthub-setup';

const TOOL_GUIDES: ToolGuide[] = [
  {
    name: 'VS Code',
    blurb: 'Adds AgentHub to your VS Code MCP servers (`.vscode/mcp.json`).',
    command: `${INSTALL_BASE} --tools vscode`,
  },
  {
    name: 'Cursor',
    blurb: 'Adds AgentHub to Cursor\u2019s MCP server list.',
    command: `${INSTALL_BASE} --tools cursor`,
  },
  {
    name: 'Claude Code (CLI)',
    blurb: 'Adds AgentHub to ~/.claude.json at user scope so it survives `claude mcp` rewrites.',
    command: `${INSTALL_BASE} --tools claude-code`,
  },
  {
    name: 'Claude Desktop',
    blurb: 'Adds AgentHub to Claude Desktop\u2019s MCP config.',
    command: `${INSTALL_BASE} --tools claude-desktop`,
  },
  {
    name: 'Continue.dev',
    blurb: 'Adds AgentHub to your Continue config so its agents can drive the browser.',
    command: `${INSTALL_BASE} --tools continue-dev`,
  },
  {
    name: 'JetBrains IDEs',
    blurb: 'Configures the AI Assistant MCP plugin in IntelliJ, PyCharm, WebStorm, etc.',
    command: `${INSTALL_BASE} --tools jetbrains`,
  },
  {
    name: 'Windsurf',
    blurb: 'Adds AgentHub to Windsurf\u2019s Cascade MCP server list.',
    command: `${INSTALL_BASE} --tools windsurf`,
  },
  {
    name: 'Zed',
    blurb: 'Adds AgentHub as a context server for Zed.',
    command: `${INSTALL_BASE} --tools zed`,
  },
];

const ALL_TOOLS_COMMAND = `${INSTALL_BASE} --update`;

export const HowToConnect: FunctionalComponent = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard may be blocked in some contexts; show a helpful message.
      setCopiedKey(`error:${key}`);
      setTimeout(() => setCopiedKey(null), 2400);
    }
  };

  return (
    <section class="bg-white border border-card-border rounded-lg p-4">
      <h3 class="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Connect another AI tool</h3>
      <p class="text-xs text-neutral-500 mb-3">
        AgentHub is a single bridge that any number of AI tools can talk to. Add it
        once per tool — works alongside any existing MCP setup. No reinstall needed
        between tools.
      </p>

      <div class="mb-3 rounded border border-neutral-200 bg-neutral-50 p-3">
        <div class="flex items-baseline justify-between gap-2 mb-1">
          <span class="text-xs font-medium text-neutral-700">Configure all detected tools at once</span>
          <button
            class="text-[10px] px-2 py-0.5 rounded bg-brand-primary text-white hover:bg-brand-primary-dark"
            onClick={() => void copy('all', ALL_TOOLS_COMMAND)}
          >
            {copiedKey === 'all' ? 'Copied!' : copiedKey === 'error:all' ? 'Copy failed' : 'Copy command'}
          </button>
        </div>
        <code class="block text-[11px] font-mono text-neutral-700 break-all select-all">
          {ALL_TOOLS_COMMAND}
        </code>
      </div>

      <div class="space-y-2">
        {TOOL_GUIDES.map((tool) => {
          const k = tool.name;
          const copied = copiedKey === k;
          const failed = copiedKey === `error:${k}`;
          return (
            <div
              key={k}
              class="rounded border border-neutral-200 bg-white p-2.5"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-neutral-800">{tool.name}</div>
                  <p class="text-[11px] text-neutral-500 mt-0.5">{tool.blurb}</p>
                </div>
                <button
                  class="text-[10px] px-2 py-0.5 rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-50 flex-shrink-0"
                  onClick={() => void copy(k, tool.command)}
                  title="Copy install command"
                >
                  {copied ? 'Copied!' : failed ? 'Copy failed' : 'Copy'}
                </button>
              </div>
              <code class="block mt-2 text-[11px] font-mono text-neutral-600 break-all select-all">
                {tool.command}
              </code>
            </div>
          );
        })}
      </div>

      <p class="text-[11px] text-neutral-500 mt-3">
        Restart the AI tool after running its command so it picks up the new MCP entry.
      </p>
    </section>
  );
};