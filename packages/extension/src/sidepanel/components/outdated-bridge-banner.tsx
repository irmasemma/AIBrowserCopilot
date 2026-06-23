import type { FunctionalComponent } from 'preact';
import { useState } from 'preact/hooks';

interface OutdatedBridgeBannerProps {
  installedVersion: string | null;
  minimumVersion: string;
}

/**
 * Banner shown when the connected native-host bridge is older than the
 * minimum version this extension was built against. Tells the user to
 * re-run the installer to upgrade.
 */
export const OutdatedBridgeBanner: FunctionalComponent<OutdatedBridgeBannerProps> = ({
  installedVersion,
  minimumVersion,
}) => {
  const [copied, setCopied] = useState(false);
  const extId = chrome.runtime?.id ?? '';
  const installCommand = extId
    ? `npx agenthub-setup@latest --update --extension-id ${extId}`
    : 'npx agenthub-setup@latest --update';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      class="mx-3 my-2 p-3 rounded border border-amber-300 bg-amber-50"
      role="alert"
      aria-label="Outdated bridge — re-run setup"
      data-testid="outdated-bridge-banner"
    >
      <div class="flex items-start gap-2 mb-2">
        <span class="text-amber-600 text-base leading-none mt-0.5" aria-hidden="true">
          {'\u26A0\uFE0F'}
        </span>
        <div class="flex-1">
          <p class="text-sm font-medium text-amber-900">Bridge is outdated</p>
          <p class="text-xs text-amber-800 mt-0.5">
            Connected native host is{' '}
            <code class="font-mono">v{installedVersion ?? 'unknown'}</code>; this extension
            requires <code class="font-mono">v{minimumVersion}</code>+.
          </p>
        </div>
      </div>
      <p class="text-xs text-amber-800 mb-1">
        Run this in any terminal to update the bridge:
      </p>
      <div class="relative">
        <pre class="text-xs bg-neutral-900 text-green-400 p-2 rounded font-mono overflow-x-auto">
          {installCommand}
        </pre>
        <button
          class="absolute top-1 right-1 text-xs text-neutral-300 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 hover:text-white"
          onClick={handleCopy}
          data-testid="outdated-bridge-banner-copy"
        >
          {copied ? '\u2713 Copied' : 'Copy'}
        </button>
      </div>
      <p class="text-xs text-amber-700 mt-2">
        After the installer finishes, restart your AI tool to reconnect.
      </p>
    </div>
  );
};
