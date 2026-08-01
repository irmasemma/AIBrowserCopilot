import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useStore, initStoreFromStorage, listenForUpdates } from '../../sidepanel/store.js';
import { ConnectionHeader, deriveHeader } from '../../sidepanel/components/connection-header.js';
import { ToolCard } from '../../sidepanel/components/tool-card.js';
import { ActivityEntryComponent } from '../../sidepanel/components/activity-entry.js';
import { SetupWizard } from '../../sidepanel/components/setup-wizard.js';
import { ChatTab } from '../../sidepanel/components/chat-tab.js';
import { SettingsTab } from '../../sidepanel/components/settings-tab.js';
import { OutdatedBridgeBanner } from '../../sidepanel/components/outdated-bridge-banner.js';
import { SiteAccessBanner } from '../../sidepanel/components/site-access-banner.js';
import { TOOL_DEFINITIONS } from '../../shared/tool-definitions.js';
import { MIN_NATIVE_HOST_VERSION } from '../../shared/version-check.js';
import { mcpTabNeedsAttention } from '../../sidepanel/mcp-tab-attention.js';

type TabId = 'chat' | 'tools' | 'mcp' | 'settings';

const TabStrip = ({
  active,
  onChange,
  mcpAttention,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  mcpAttention: boolean;
}) => {
  const tabs: Array<{ id: TabId; label: string }> = [
    // Chat tab is temporarily hidden from the tab strip for the CWS release
    // (known bug — see chat-tab.tsx). The tab's content/logic is untouched
    // and still mounted in App(); it's just unreachable via this nav.
    // { id: 'chat', label: 'Chat' },
    // MCP is first and is the default active tab for this release; Tools
    // moved after it. Order swap only — no behavior change.
    { id: 'mcp', label: 'MCP' },
    { id: 'tools', label: 'Tools' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <>
      <nav class="flex border-b border-card-border bg-white" role="tablist">
        {tabs.map((t) => {
          const isActive = active === t.id;
          const showBadge = t.id === 'mcp' && mcpAttention;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-label={
                t.id === 'mcp'
                  ? mcpAttention
                    ? 'MCP — connection needs attention'
                    : 'MCP'
                  : undefined
              }
              class={`flex-1 text-sm py-2 transition-colors ${
                isActive
                  ? 'text-brand-primary border-b-2 border-brand-primary font-medium'
                  : 'text-neutral-500 border-b-2 border-transparent hover:text-neutral-800'
              }`}
              onClick={() => onChange(t.id)}
            >
              {t.label}
              {showBadge && (
                <>
                  {/* Non-color-only badge: amber glyph + visually-hidden text so
                      the alert never depends on color perception alone. */}
                  <span
                    class="ml-1 font-bold text-amber-600"
                    aria-hidden="true"
                    data-testid="mcp-tab-attention-badge"
                  >
                    !
                  </span>
                  <span class="sr-only">connection needs attention</span>
                </>
              )}
            </button>
          );
        })}
      </nav>
      {/* Single polite live region announcing the MCP badge state to screen
          readers; empty when there is nothing to report. */}
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        data-testid="mcp-tab-attention-status"
      >
        {mcpAttention ? 'MCP connection needs attention' : ''}
      </span>
    </>
  );
};

const McpTab = ({
  needsSetup,
  onSetupComplete,
}: {
  needsSetup: boolean;
  onSetupComplete: () => void;
}) => {
  const connectionContext = useStore((s) => s.connectionContext);

  // First-launch onboarding lives HERE now (not as a full-screen override):
  // the wizard only replaces the MCP tab's content, never the whole app.
  if (needsSetup) {
    return <SetupWizard onComplete={onSetupComplete} />;
  }

  return (
    <>
      <ConnectionHeader />
      {connectionContext.versionStatus === 'outdated' && (
        <OutdatedBridgeBanner
          installedVersion={connectionContext.serverInfo?.version ?? null}
          minimumVersion={MIN_NATIVE_HOST_VERSION}
        />
      )}
    </>
  );
};

const ToolsTab = () => {
  const activityLog = useStore((s) => s.activityLog);
  const toolPermissions = useStore((s) => s.toolPermissions);
  const toggleTool = useStore((s) => s.toggleTool);

  return (
    <div class="h-full overflow-y-auto px-3 py-3 space-y-3">
      <section>
        <h2 class="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
          Permissions
        </h2>
        <p class="text-xs text-neutral-500 mb-2">
          Toggle which browser actions external AI tools (and the Chat tab) are
          allowed to use. All tools are free.
        </p>
        <div class="bg-white border border-card-border rounded-lg overflow-hidden divide-y divide-neutral-100">
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
      <section>
        <h2 class="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
          Activity Log
        </h2>
        {activityLog.length === 0 ? (
          <div class="bg-log-bg text-log-text rounded-lg px-3 py-3 font-mono text-[11px] text-neutral-400 italic">
            No activity yet — try asking AgentHub to do something, or connect an
            MCP-capable AI tool.
          </div>
        ) : (
          <div class="bg-log-bg rounded-lg py-2 max-h-96 overflow-y-auto">
            {activityLog.slice(0, 50).map((entry) => (
              <ActivityEntryComponent key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export const App = () => {
  const connectionContext = useStore((s) => s.connectionContext);
  const [setupComplete, setSetupComplete] = useState(false);
  // MCP is the default active tab for this release (Chat tab hidden — see
  // TabStrip above).
  const [activeTab, setActiveTab] = useState<TabId>('mcp');

  useEffect(() => {
    initStoreFromStorage();
    listenForUpdates();
    chrome.storage.local.get('setupComplete', (data) => {
      if (data.setupComplete) setSetupComplete(true);
    });

    // Keepalive port — prevents the background SW from being evicted while
    // this panel is open. The SW is the only thing that owns the WebSocket
    // to the bridge, so eviction = lost connection mid-agent-run. While this
    // port is connected, port message activity counts as SW activity.
    let keepalivePort: chrome.runtime.Port | null = null;
    let keepaliveTimer: number | null = null;
    try {
      keepalivePort = chrome.runtime.connect({ name: 'panel-keepalive' });
      keepaliveTimer = window.setInterval(() => {
        try {
          keepalivePort?.postMessage({ ping: Date.now() });
        } catch {
          // Port may have been disconnected — let the SW respawn handle it.
        }
      }, 25_000);
    } catch {
      // chrome.runtime may not be available in some test contexts.
    }

    return () => {
      if (keepaliveTimer !== null) window.clearInterval(keepaliveTimer);
      try {
        keepalivePort?.disconnect();
      } catch { /* ignore */ }
    };
  }, []);

  const handleSetupComplete = () => {
    setSetupComplete(true);
    chrome.storage.local.set({ setupComplete: true });
  };

  const { state, diagnosticReason, lastConnectedAt } = connectionContext;

  // First-launch onboarding: only relevant if the user has never connected MCP
  // and the helper isn't installed yet. This boolean is UNCHANGED (it reads
  // discovery outputs read-only); it now only switches the MCP tab's CONTENT
  // (SetupWizard vs live status) — it never blanks the app anymore. MCP is
  // the default/first tab for this release, so first-launch lands here.
  const needsSetup = !setupComplete && (
    diagnosticReason === 'helper_unavailable' ||
    (state === 'disconnected' && !lastConnectedAt && !diagnosticReason)
  );

  // Conservative MCP-tab attention badge. `deriveHeader` with api:null is a
  // READ-ONLY reuse of the existing verdict adapter — client-only facts are
  // enough for a badge (untested/working are excluded so no false alarm), and
  // this never touches connection discovery.
  const hasEngagedMcp = connectionContext.lastConnectedAt != null;
  const mcpVerdict = deriveHeader({
    state,
    diagnosticReason,
    failureCount: connectionContext.failureCount,
    lastConnectedAt,
    reconnectingSinceMs: null,
    versionStatus: connectionContext.versionStatus,
    reconnectsThisSession: connectionContext.reconnectsThisSession,
    lastVerifiedAt: connectionContext.lastVerifiedAt,
    api: null,
    quickCheckPassed: false,
  });
  const mcpAttention = mcpTabNeedsAttention({
    hasEngagedMcp,
    severity: mcpVerdict.severity,
    kind: mcpVerdict.kind,
  });

  return (
    <div class="flex flex-col h-screen bg-panel">
      {/* Banner-placement rule: a banner stays global (above TabStrip, visible
          from every tab) IFF it gates a capability usable from the current tab
          regardless of tab. SiteAccessBanner gates content tools invoked from
          Chat, so it stays global. MCP/bridge/install-only messages
          (ConnectionHeader, OutdatedBridgeBanner, SetupWizard) move to the MCP
          tab because they don't gate anything usable outside it. */}
      <SiteAccessBanner />
      <TabStrip active={activeTab} onChange={setActiveTab} mcpAttention={mcpAttention} />
      {/*
        Tab panels are always mounted; visibility is toggled with `hidden`
        so per-tab state (chat transcript, in-flight model run, drafts,
        revealed keys, etc.) survives tab switches. Unmounting these
        components on every switch would discard the chat history and
        cancel any active conversation, which was the prior behavior. This is
        also load-bearing for the relocated ConnectionHeader: it keeps computing
        its verdict while the MCP tab is hidden (no discovery change).
      */}
      <div class="flex-1 min-h-0">
        <div class={`h-full ${activeTab === 'chat' ? '' : 'hidden'}`}>
          <ChatTab
            isActive={activeTab === 'chat'}
            onOpenSettings={() => setActiveTab('settings')}
          />
        </div>
        <div class={`h-full ${activeTab === 'tools' ? '' : 'hidden'}`}>
          <ToolsTab />
        </div>
        <div
          class={`h-full overflow-y-auto ${activeTab === 'mcp' ? '' : 'hidden'}`}
          data-testid="mcp-panel"
        >
          <McpTab needsSetup={needsSetup} onSetupComplete={handleSetupComplete} />
        </div>
        <div class={`h-full overflow-y-auto ${activeTab === 'settings' ? '' : 'hidden'}`}>
          <SettingsTab />
        </div>
      </div>
    </div>
  );
};

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
