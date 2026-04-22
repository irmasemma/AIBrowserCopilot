import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, initStoreFromStorage, listenForUpdates } from '../../sidepanel/store.js';
import { ConnectionHeader } from '../../sidepanel/components/connection-header.js';
import { ToolCard } from '../../sidepanel/components/tool-card.js';
import { ActivityEntryComponent } from '../../sidepanel/components/activity-entry.js';
import { SetupWizard } from '../../sidepanel/components/setup-wizard.js';
import { useLicense } from '../../sidepanel/hooks/use-license.js';
import { TOOL_DEFINITIONS } from '../../shared/tool-definitions.js';

const SUPPORT_URL = 'https://github.com/irmasemma/AIBrowserCopilot/issues';
const FAQ_URL = 'https://github.com/irmasemma/AIBrowserCopilot/wiki/FAQ';

const App = () => {
  const connectionContext = useStore((s) => s.connectionContext);
  const activityLog = useStore((s) => s.activityLog);
  const toolPermissions = useStore((s) => s.toolPermissions);
  const toggleTool = useStore((s) => s.toggleTool);
  const [setupComplete, setSetupComplete] = useState(false);
  const license = useLicense();

  useEffect(() => {
    initStoreFromStorage();
    listenForUpdates();
    // Check if setup was already completed in a previous session
    chrome.storage.local.get('setupComplete', (data) => {
      if (data.setupComplete) setSetupComplete(true);
    });
  }, []);

  const handleSetupComplete = () => {
    setSetupComplete(true);
    chrome.storage.local.set({ setupComplete: true });
  };

  const hasLicense = license.hasLicense;
  const { state, diagnosticReason, lastConnectedAt } = connectionContext;

  // Show setup wizard when:
  // 1. NM helper not installed (fresh install, no native host) AND not manually dismissed
  // 2. Disconnected with no prior connection AND no specific diagnostic (very first launch)
  const needsSetup = !setupComplete && (
    diagnosticReason === 'helper_unavailable' ||
    (state === 'disconnected' && !lastConnectedAt && !diagnosticReason)
  );

  // Show "start your AI tool" guidance when helper is installed but nothing is running
  const waitingForAITool = !needsSetup && (
    state === 'disconnected' || state === 'reconnecting'
  ) && diagnosticReason === 'no_lock_file';

  if (needsSetup) {
    return (
      <div class="flex flex-col h-screen bg-neutral-50">
        <ConnectionHeader />
        <div class="flex-1 overflow-y-auto">
          <SetupWizard onComplete={handleSetupComplete} />
        </div>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-screen bg-neutral-50">
      <ConnectionHeader />
      <div class="flex-1 overflow-y-auto">
        {waitingForAITool && (
          <div class="mx-3 my-2 p-3 rounded border-l-4 border-amber-300 bg-amber-50" role="status">
            <p class="text-sm font-medium text-amber-900 mb-1">Waiting for AI tool</p>
            <p class="text-xs text-amber-700 mb-2">
              Open an AI tool that uses MCP to connect. The extension will detect it automatically.
            </p>
            <div class="text-xs text-amber-700 space-y-1">
              <p class="font-medium">Supported tools:</p>
              <ul class="list-disc list-inside space-y-0.5 text-amber-600">
                <li>Claude Code (terminal)</li>
                <li>VS Code with Copilot or Continue</li>
                <li>Cursor</li>
                <li>Windsurf</li>
                <li>Any MCP-compatible AI tool</li>
              </ul>
            </div>
            <button
              class="mt-2 text-xs font-medium text-white bg-amber-500 px-3 py-1.5 rounded hover:bg-amber-600"
              onClick={() => chrome.runtime.sendMessage({ type: 'retry_connection' })}
            >
              Check Again
            </button>
          </div>
        )}
        {!waitingForAITool && state === 'disconnected' && connectionContext.error && (
          <div class="mx-3 my-2 p-3 rounded border-l-4 border-red-300 bg-red-50" role="alert">
            <p class="text-sm text-red-800 mb-2">{connectionContext.error}</p>
            <button
              class="text-xs font-medium text-white bg-red-500 px-3 py-1 rounded hover:bg-red-600"
              onClick={() => chrome.runtime.sendMessage({ type: 'retry_connection' })}
            >
              Reconnect
            </button>
          </div>
        )}
        <section class="py-3">
          <h2 class="px-3 text-sm font-semibold text-neutral-500 mb-1">Tools</h2>
          {TOOL_DEFINITIONS.map((tool) => (
            <ToolCard
              key={tool.name}
              name={tool.name}
              displayName={tool.displayName}
              description={tool.description}
              icon={tool.icon}
              tier={tool.tier}
              enabled={toolPermissions[tool.name] ?? true}
              hasLicense={hasLicense}
              onToggle={() => toggleTool(tool.name)}
            />
          ))}
        </section>
        <section class="py-3 border-t border-neutral-200">
          <h2 class="px-3 text-sm font-semibold text-neutral-500 mb-1">Activity</h2>
          {activityLog.length === 0 ? (
            <p class="px-3 text-xs text-neutral-400 py-4">No activity yet. Ask your AI to read a page to get started.</p>
          ) : (
            activityLog.slice(0, 50).map((entry) => (
              <ActivityEntryComponent key={entry.id} entry={entry} />
            ))
          )}
        </section>
        <section id="support-section" class="py-3 border-t border-neutral-200 px-3">
          <a href={SUPPORT_URL} target="_blank" rel="noopener" class="text-xs text-brand-primary hover:underline">Report a Problem</a>
          <span class="text-xs text-neutral-300 mx-2">{'\u00B7'}</span>
          <a href={FAQ_URL} target="_blank" rel="noopener" class="text-xs text-brand-primary hover:underline">Is this safe?</a>
        </section>
      </div>
      {!hasLicense && (
        <div class="border-t border-neutral-200 px-3 py-2 bg-white">
          <button
            class="w-full text-sm font-medium text-white bg-brand-primary py-2 rounded hover:bg-brand-primary-dark"
            onClick={() => chrome.tabs.create({ url: 'https://github.com/irmasemma/AIBrowserCopilot/wiki/Pro' })}
          >
            Upgrade to Pro
          </button>
        </div>
      )}
    </div>
  );
};

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
