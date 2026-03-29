import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';

interface UpgradePromptProps {
  toolName: string;
  toolDescription: string;
}

export const UpgradePrompt: FunctionalComponent<UpgradePromptProps> = ({ toolName, toolDescription }) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      class="mx-3 mb-2 p-3 rounded border border-brand-primary/20 bg-brand-primary-light"
      role="region"
      aria-label={`Upgrade to unlock ${toolName}`}
    >
      <div class="text-xs text-neutral-700 mb-2">{toolDescription}</div>
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-brand-primary">$7/mo Pro</span>
        <div class="flex gap-2">
          <button
            class="text-xs text-neutral-400 hover:text-neutral-600"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </button>
          <button
            class="text-xs font-medium text-white bg-brand-primary px-3 py-1 rounded hover:bg-brand-primary-dark"
            onClick={() => {
              // Open external payment page — will be wired in Epic 6
              chrome.tabs.create({ url: 'https://github.com/irmasemma/AIBrowserCopilot/wiki/Pro' });
            }}
          >
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
};
