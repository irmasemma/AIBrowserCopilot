import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ErrorCard } from './error-card.js';
import { trackSetupEvent } from '../../setup/telemetry.js';

interface SetupWizardProps {
  onComplete: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/irmasemma/AIBrowserCopilot';
const POLL_INTERVAL_MS = 3000;

export const SetupWizard: FunctionalComponent<SetupWizardProps> = ({ onComplete }) => {
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const extId = chrome.runtime?.id ?? '';
  const installCommand = extId
    ? `npx agenthub-setup --extension-id ${extId}`
    : 'npx agenthub-setup';

  useEffect(() => {
    trackSetupEvent('setup_started');

    setPolling(true);
    pollRef.current = setInterval(async () => {
      chrome.runtime.sendMessage({ type: 'retry_connection' }).catch(() => {});
      const data = await chrome.storage.local.get('connectionState');
      const state = data.connectionState;
      if (state?.state === 'connected') {
        if (pollRef.current) clearInterval(pollRef.current);
        trackSetupEvent('first_connection');
        onComplete();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [onComplete]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    trackSetupEvent('bridge_download_started');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    await chrome.runtime.sendMessage({ type: 'retry_connection' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    const data = await chrome.storage.local.get('connectionState');
    const state = data.connectionState;
    if (state?.state === 'connected') {
      if (pollRef.current) clearInterval(pollRef.current);
      trackSetupEvent('first_connection');
      onComplete();
    } else {
      setError('Not connected yet. Make sure the installer completed and your AI tool is running.');
    }
  };

  const handleEmailCapture = async () => {
    if (!email) return;
    await chrome.storage.local.set({ setupFailEmail: email });
    setEmail('');
    setError(null);
  };

  return (
    <div class="py-4">
      <div class="px-3 mb-4">
        <h2 class="text-lg font-semibold text-neutral-900">Welcome to AgentHub</h2>
        <p class="text-xs text-neutral-500 mt-1">Let your AI read pages, fill forms, and interact with your browser</p>
      </div>

      {/* Step 1: Run the installer */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-brand-primary bg-white">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-brand-primary text-white">1</span>
          <span class="text-sm font-medium text-neutral-900">Run Setup</span>
        </div>
        <div class="ml-7 space-y-2">
          <p class="text-xs text-neutral-600">
            Open any terminal and paste this command. It downloads the bridge, registers it with your browser, and configures your AI tools automatically.
          </p>
          <div class="relative">
            <pre class="text-xs bg-neutral-900 text-green-400 p-2.5 rounded font-mono overflow-x-auto">{installCommand}</pre>
            <button
              class="absolute top-1.5 right-1.5 text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 hover:text-white"
              onClick={handleCopy}
            >
              {copied ? '\u2713 Copied' : 'Copy'}
            </button>
          </div>
          <p class="text-xs text-neutral-400">
            Requires <a href="https://nodejs.org" target="_blank" rel="noopener" class="text-brand-primary hover:underline">Node.js 18+</a>.
            No need to download anything else.
          </p>
          <p class="text-xs text-amber-600 font-medium">
            After the installer finishes, restart Chrome completely (close all windows and reopen) for the registration to take effect.
          </p>
        </div>
      </div>

      {/* Step 2: Open your AI tool */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-neutral-200 bg-neutral-50">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-neutral-300 text-white">2</span>
          <span class="text-sm font-medium text-neutral-900">Open Your AI Tool</span>
        </div>
        <div class="ml-7 space-y-2">
          <p class="text-xs text-neutral-600">
            After the installer finishes, open (or restart) your AI tool. The extension connects automatically.
          </p>
          <ul class="text-xs text-neutral-500 list-disc list-inside space-y-0.5">
            <li>Claude Code (terminal)</li>
            <li>VS Code with Copilot or Continue</li>
            <li>Cursor</li>
            <li>Windsurf</li>
            <li>Any MCP-compatible AI tool</li>
          </ul>
          {polling && !error && (
            <div class="flex items-center gap-2 mt-2">
              <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <p class="text-xs text-neutral-500">Listening for connection...</p>
            </div>
          )}
          <button
            class="mt-1 text-xs font-medium text-white bg-brand-primary px-3 py-1.5 rounded hover:bg-brand-primary-dark"
            onClick={handleTestConnection}
          >
            Test Connection
          </button>
        </div>
      </div>

      {/* Already done setup? Skip. */}
      <div class="mx-3 mb-3 text-center">
        <button
          class="text-xs text-neutral-400 hover:text-neutral-600 underline"
          onClick={onComplete}
        >
          I've already completed setup — skip this
        </button>
      </div>

      {/* Error with email capture */}
      {error && (
        <div class="mx-3">
          <ErrorCard
            message={error}
            actionLabel="Retry"
            onAction={handleTestConnection}
            helpUrl={`${GITHUB_REPO_URL}/wiki/Setup-Help`}
          />
          <div class="mt-2 flex gap-1">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              class="flex-1 text-xs border border-neutral-200 rounded px-2 py-1"
            />
            <button
              class="text-xs text-brand-primary hover:underline px-2"
              onClick={handleEmailCapture}
            >
              Get help
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
