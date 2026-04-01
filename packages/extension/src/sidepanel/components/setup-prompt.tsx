import { h } from 'preact';
import { useState } from 'preact/hooks';
import type { ToolScanResult } from '../../shared/types.js';

interface SetupPromptProps {
  unconfiguredTools: ToolScanResult[];
}

export function getSetupMessage(tools: ToolScanResult[]): string {
  if (tools.length === 0) return '';
  if (tools.length === 1) return `${tools[0].tool} detected but not configured.`;
  return `${tools.length} tools detected but not configured: ${tools.map((t) => t.tool).join(', ')}.`;
}

export function SetupPrompt({ unconfiguredTools }: SetupPromptProps) {
  const [copied, setCopied] = useState(false);

  if (unconfiguredTools.length === 0) return null;

  const message = getSetupMessage(unconfiguredTools);
  const command = 'npx ai-browser-copilot-setup';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div class="mx-3 my-2 p-2 bg-amber-50 border border-amber-200 rounded-md text-sm">
      <p class="text-amber-800 mb-1">{message}</p>
      <p class="text-amber-700 text-xs mb-2">
        Run setup to connect:
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 bg-amber-100 px-2 py-1 rounded text-xs font-mono text-amber-900">
          {command}
        </code>
        <button
          onClick={handleCopy}
          class="px-2 py-1 bg-amber-200 hover:bg-amber-300 rounded text-xs text-amber-900 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
