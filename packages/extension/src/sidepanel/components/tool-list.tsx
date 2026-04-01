import { h } from 'preact';
import type { ToolScanResult, ServerInfo } from '../../shared/types.js';

interface ToolListProps {
  tools: ToolScanResult[];
  serverInfo: ServerInfo | null;
}

export function getToolStatus(
  tool: ToolScanResult,
  activeSlug: string | null,
): 'active' | 'configured' | 'unconfigured' {
  if (tool.configured && tool.slug === activeSlug) return 'active';
  if (tool.configured) return 'configured';
  return 'unconfigured';
}

export function getToolStatusLabel(status: 'active' | 'configured' | 'unconfigured'): string {
  switch (status) {
    case 'active': return 'connected';
    case 'configured': return 'configured';
    case 'unconfigured': return 'not configured';
  }
}

export function getToolStatusIcon(status: 'active' | 'configured' | 'unconfigured'): string {
  switch (status) {
    case 'active': return '✅';
    case 'configured': return '✓';
    case 'unconfigured': return '⚠️';
  }
}

function getActiveSlug(serverInfo: ServerInfo | null): string | null {
  if (!serverInfo?.startedBy) return null;
  // Map startedBy to slug (e.g., "claude-code" → "claude-code")
  return serverInfo.startedBy.toLowerCase().replace(/\s+/g, '-');
}

export function ToolList({ tools, serverInfo }: ToolListProps) {
  // Only show installed tools
  const installed = tools.filter((t) => t.installed);
  const activeSlug = getActiveSlug(serverInfo);

  if (installed.length === 0) {
    return (
      <div class="px-3 py-2 text-xs text-gray-400">
        Connect to see your AI tools
      </div>
    );
  }

  return (
    <div class="px-3 py-2">
      <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
        AI Tools
      </div>
      <div class="space-y-1">
        {installed.map((tool) => {
          const status = getToolStatus(tool, activeSlug);
          const label = getToolStatusLabel(status);
          const icon = getToolStatusIcon(status);
          return (
            <div
              key={tool.slug}
              class={`flex items-center justify-between text-sm py-0.5 ${
                status === 'unconfigured' ? 'text-amber-600' : 'text-gray-700'
              }`}
            >
              <span>
                {icon} {tool.tool}
              </span>
              <span class="text-xs text-gray-400">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
