import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ErrorCard } from './error-card.js';
import { trackSetupEvent } from '../../setup/telemetry.js';

interface SetupWizardProps {
  onComplete: () => void;
}

const NPX_COMMAND = 'npx ai-browser-copilot-setup';
const GITHUB_RELEASES_URL = 'https://github.com/irmasemma/AIBrowserCopilot/releases/latest';
const POLL_INTERVAL_MS = 3000;

export const SetupWizard: FunctionalComponent<SetupWizardProps> = ({ onComplete }) => {
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    trackSetupEvent('setup_started');

    // Start polling for native host connection immediately
    setPolling(true);
    pollRef.current = setInterval(async () => {
      // Ask background to retry connection (in case native host was just installed)
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

  const handleCopyCommand = async () => {
    await navigator.clipboard.writeText(NPX_COMMAND);
    setCopied(true);
    trackSetupEvent('bridge_download_started');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    // Trigger a fresh connection attempt
    await chrome.runtime.sendMessage({ type: 'retry_connection' }).catch(() => {});
    // Wait briefly for connection to establish
    await new Promise((r) => setTimeout(r, 1000));
    const data = await chrome.storage.local.get('connectionState');
    const state = data.connectionState;
    if (state?.state === 'connected') {
      if (pollRef.current) clearInterval(pollRef.current);
      trackSetupEvent('first_connection');
      onComplete();
    } else {
      setError('Not connected yet. Make sure the installer completed and your AI app has restarted.');
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
        <h2 class="text-lg font-semibold text-neutral-900">Setup Assistant</h2>
        <p class="text-xs text-neutral-500">One command to connect your browser to your AI assistant</p>
      </div>

      {/* Step 1: Run the installer */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-brand-primary bg-white">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-brand-primary text-white">1</span>
          <span class="text-sm font-medium text-neutral-900">Run Setup Command</span>
        </div>
        <div class="ml-7 space-y-3">
          <p class="text-xs text-neutral-600">
            Open a terminal and run this command. It downloads the bridge, registers it with Chrome, and configures your AI tools automatically.
          </p>

          {/* Command block */}
          <div class="relative">
            <pre class="text-sm bg-neutral-900 text-green-400 p-3 rounded font-mono overflow-x-auto">{NPX_COMMAND}</pre>
            <button
              class="absolute top-1.5 right-1.5 text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 hover:text-white"
              onClick={handleCopyCommand}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <p class="text-xs text-neutral-400">
            Requires <a href="https://nodejs.org" target="_blank" rel="noopener" class="text-brand-primary hover:underline">Node.js 18+</a>.
            {' '}Or <a href={GITHUB_RELEASES_URL} target="_blank" rel="noopener" class="text-brand-primary hover:underline">download the binary</a> manually.
          </p>
        </div>
      </div>

      {/* Waiting indicator */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-neutral-200 bg-neutral-50">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-neutral-300 text-white">2</span>
          <span class="text-sm font-medium text-neutral-900">Waiting for Connection</span>
        </div>
        <div class="ml-7 space-y-2">
          {polling && !error && (
            <div class="flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <p class="text-xs text-neutral-500">Waiting for setup to complete...</p>
            </div>
          )}
          <p class="text-xs text-neutral-400">
            This page will update automatically once the bridge is connected.
          </p>
          <button
            class="text-xs font-medium text-white bg-brand-primary px-3 py-1.5 rounded hover:bg-brand-primary-dark"
            onClick={handleTestConnection}
          >
            Test Connection
          </button>
        </div>
      </div>

      {/* Error with email capture */}
      {error && (
        <div class="mx-3">
          <ErrorCard
            message={error}
            actionLabel="Retry"
            onAction={handleTestConnection}
            helpUrl="https://github.com/irmasemma/AIBrowserCopilot/wiki/Setup-Help"
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
