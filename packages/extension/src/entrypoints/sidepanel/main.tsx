import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, initStoreFromStorage, listenForUpdates } from '../../sidepanel/store.js';
import { ConnectionHeader } from '../../sidepanel/components/connection-header.js';
import { ToolCard } from '../../sidepanel/components/tool-card.js';
import { ActivityEntryComponent } from '../../sidepanel/components/activity-entry.js';
import { SetupWizard } from '../../sidepanel/components/setup-wizard.js';
import { ChatTab } from '../../sidepanel/components/chat-tab.js';
import { SettingsTab } from '../../sidepanel/components/settings-tab.js';
import { OutdatedBridgeBanner } from '../../sidepanel/components/outdated-bridge-banner.js';
import { SiteAccessBanner } from '../../sidepanel/components/site-access-banner.js';
import { TOOL_DEFINITIONS } from '../../shared/tool-definitions.js';
import { MIN_NATIVE_HOST_VERSION } from '../../shared/version-check.js';

type TabId = 'chat' | 'tools' | 'settings';

const TabStrip = ({ active, onChange }: { active: TabId; onChange: (id: TabId) => void }) => {
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'chat', label: 'Chat' },
    { id: 'tools', label: 'Tools' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <nav class="flex border-b border-neutral-200 bg-white" role="tablist">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            class={`flex-1 text-sm py-2 transition-colors ${
              isActive
                ? 'text-brand-primary border-b-2 border-brand-primary font-medium'
                : 'text-neutral-500 border-b-2 border-transparent hover:text-neutral-800'
            }`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
};

const ToolsTab = () => {
  const activityLog = useStore((s) => s.activityLog);
  const toolPermissions = useStore((s) => s.toolPermissions);
  const toggleTool = useStore((s) => s.toggleTool);

  return (
    <div class="h-full overflow-y-auto">
      <section class="py-4">
        <h2 class="px-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Tools
        </h2>
        <p class="px-4 text-xs text-neutral-500 mb-2">
          Toggle which browser actions external AI tools (and the Chat tab) are
          allowed to use. All tools are free.
        </p>
        <div class="divide-y divide-neutral-100">
          {TOOL_DEFINITIONS.map((tool) => (
            <ToolCard
              key={tool.name}
              name={tool.name}
              displayName={tool.displayName}
              description={tool.description}
              icon={tool.icon}
              enabled={toolPermissions[tool.name] ?? true}
              onToggle={() => toggleTool(tool.name)}
            />
          ))}
        </div>
      </section>
      <section class="py-4 border-t border-neutral-200">
        <h2 class="px-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Activity
        </h2>
        {activityLog.length === 0 ? (
          <p class="px-4 text-xs text-neutral-400 py-4">
            No activity yet — try asking CoPilot to do something, or connect an
            MCP-capable AI tool.
          </p>
        ) : (
          <div class="divide-y divide-neutral-100">
            {activityLog.slice(0, 50).map((entry) => (
              <ActivityEntryComponent key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const App = () => {
  const connectionContext = useStore((s) => s.connectionContext);
  const [setupComplete, setSetupComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('chat');

  useEffect(() => {
    initStoreFromStorage();
    listenForUpdates();
    chrome.storage.local.get('setupComplete', (data) => {
      if (data.setupComplete) setSetupComplete(true);
    });
  }, []);

  const handleSetupComplete = () => {
    setSetupComplete(true);
    chrome.storage.local.set({ setupComplete: true });
  };

  const { state, diagnosticReason, lastConnectedAt } = connectionContext;

  // First-launch onboarding: only override if user has never connected MCP and the helper
  // isn't installed yet. Once dismissed (or once the user has used Chat instead), the
  // normal tabbed UI shows. Chat works without MCP, so this is no longer a hard block.
  const needsSetup = !setupComplete && (
    diagnosticReason === 'helper_unavailable' ||
    (state === 'disconnected' && !lastConnectedAt && !diagnosticReason)
  );

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
      <SiteAccessBanner />
      {connectionContext.versionStatus === 'outdated' && (
        <OutdatedBridgeBanner
          installedVersion={connectionContext.serverInfo?.version ?? null}
          minimumVersion={MIN_NATIVE_HOST_VERSION}
        />
      )}
      <TabStrip active={activeTab} onChange={setActiveTab} />
      <div class="flex-1 min-h-0">
        {activeTab === 'chat' && <ChatTab onOpenSettings={() => setActiveTab('settings')} />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'settings' && (
          <div class="h-full overflow-y-auto">
            <SettingsTab />
          </div>
        )}
      </div>
    </div>
  );
};

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
