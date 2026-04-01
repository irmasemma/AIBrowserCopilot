import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, initStoreFromStorage, listenForUpdates } from '../../sidepanel/store.js';
import { ConnectionHeader } from '../../sidepanel/components/connection-header.js';
import { ToolCard } from '../../sidepanel/components/tool-card.js';
import { ActivityEntryComponent } from '../../sidepanel/components/activity-entry.js';
import { ErrorCard } from '../../sidepanel/components/error-card.js';
import { SetupWizard } from '../../sidepanel/components/setup-wizard.js';
import { useLicense } from '../../sidepanel/hooks/use-license.js';
import { TOOL_DEFINITIONS } from '../../shared/tool-definitions.js';

const SUPPORT_URL = 'https://github.com/irmasemma/AIBrowserCopilot/issues';
const FAQ_URL = 'https://github.com/irmasemma/AIBrowserCopilot/wiki/FAQ';

const App = () => {
  const connection = useStore((s) => s.connection);
  const activityLog = useStore((s) => s.activityLog);
  const toolPermissions = useStore((s) => s.toolPermissions);
  const toggleTool = useStore((s) => s.toggleTool);
  const [setupComplete, setSetupComplete] = useState(false);
  const license = useLicense();

  useEffect(() => {
    initStoreFromStorage();
    listenForUpdates();
  }, []);

  const hasLicense = license.hasLicense;
  const needsSetup = connection.state === 'setup-needed' && !setupComplete;

  if (needsSetup) {
    return (
      <div class="flex flex-col h-screen bg-neutral-50">
        <ConnectionHeader state={connection.state} connectionInfo={connection} />
        <div class="flex-1 overflow-y-auto">
          <SetupWizard onComplete={() => setSetupComplete(true)} />
        </div>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-screen bg-neutral-50">
      <ConnectionHeader state={connection.state} connectionInfo={connection} />
      <div class="flex-1 overflow-y-auto">
        {connection.state === 'waiting' && (
          <ErrorCard
            message="Waiting for AI tool — start Claude Code, VS Code, or another MCP host to connect."
            actionLabel="Retry Now"
            onAction={() => chrome.runtime.sendMessage({ type: 'retry_connection' })}
            helpUrl={FAQ_URL}
          />
        )}
        {connection.state === 'disconnected' && connection.error && (
          <ErrorCard
            message={connection.error}
            actionLabel="Reconnect"
            onAction={() => chrome.runtime.sendMessage({ type: 'retry_connection' })}
            helpUrl={FAQ_URL}
          />
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
          <span class="text-xs text-neutral-300 mx-2">·</span>
          <a href={FAQ_URL} target="_blank" rel="noopener" class="text-xs text-brand-primary hover:underline">Is this safe?</a>
        </section>
      </div>
      {!hasLicense && (
        <div class="border-t border-neutral-200 px-3 py-2 bg-white">
          <button
            class="w-full text-sm font-medium text-white bg-brand-primary py-2 rounded hover:bg-brand-primary-dark"
            onClick={() => chrome.tabs.create({ url: 'https://github.com/irmasemma/AIBrowserCopilot/wiki/Pro' })}
          >
            Upgrade to Pro — $7/mo
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
