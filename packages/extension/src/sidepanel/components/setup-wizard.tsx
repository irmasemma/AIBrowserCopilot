import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { ErrorCard } from './error-card.js';
import { trackSetupEvent } from '../../setup/telemetry.js';

interface SetupWizardProps {
  onComplete: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/irmasemma/AIBrowserCopilot';
const GITHUB_RELEASES_URL = 'https://github.com/irmasemma/AIBrowserCopilot/releases/latest';
const POLL_INTERVAL_MS = 3000;

export const SetupWizard: FunctionalComponent<SetupWizardProps> = ({ onComplete }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const extId = chrome.runtime?.id ?? '';

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

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    trackSetupEvent('bridge_download_started');
    setTimeout(() => setCopied(null), 2000);
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
      setError('Not connected yet. Make sure you completed all steps and your AI tool has been restarted.');
    }
  };

  const handleEmailCapture = async () => {
    if (!email) return;
    await chrome.storage.local.set({ setupFailEmail: email });
    setEmail('');
    setError(null);
  };

  const installCommand = extId
    ? `npm run setup -- --extension-id ${extId}`
    : 'npm run setup';

  return (
    <div class="py-4">
      <div class="px-3 mb-4">
        <h2 class="text-lg font-semibold text-neutral-900">Welcome to AI Browser CoPilot</h2>
        <p class="text-xs text-neutral-500 mt-1">Connect your browser to your AI assistant in 3 steps</p>
      </div>

      {/* Step 1: Clone the repo */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-brand-primary bg-white">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-brand-primary text-white">1</span>
          <span class="text-sm font-medium text-neutral-900">Get the Source</span>
        </div>
        <div class="ml-7 space-y-2">
          <p class="text-xs text-neutral-600">
            Clone the repository (or download the <a href={GITHUB_RELEASES_URL} target="_blank" rel="noopener" class="text-brand-primary hover:underline">latest release</a>):
          </p>
          <div class="relative">
            <pre class="text-xs bg-neutral-900 text-green-400 p-2.5 rounded font-mono overflow-x-auto">git clone {GITHUB_REPO_URL}.git{'\n'}cd AIBrowserCopilot{'\n'}npm install</pre>
            <button
              class="absolute top-1.5 right-1.5 text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 hover:text-white"
              onClick={() => handleCopy(`git clone ${GITHUB_REPO_URL}.git && cd AIBrowserCopilot && npm install`, 'clone')}
            >
              {copied === 'clone' ? '\u2713 Copied' : 'Copy'}
            </button>
          </div>
          <p class="text-xs text-neutral-400">
            Requires <a href="https://nodejs.org" target="_blank" rel="noopener" class="text-brand-primary hover:underline">Node.js 18+</a> and <a href="https://git-scm.com" target="_blank" rel="noopener" class="text-brand-primary hover:underline">Git</a>.
          </p>
        </div>
      </div>

      {/* Step 2: Run the installer */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-brand-primary bg-white">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-brand-primary text-white">2</span>
          <span class="text-sm font-medium text-neutral-900">Run the Installer</span>
        </div>
        <div class="ml-7 space-y-2">
          <p class="text-xs text-neutral-600">
            From the project folder, run the setup command. It builds the bridge, registers it with your browser, and configures your AI tools.
          </p>
          <div class="relative">
            <pre class="text-xs bg-neutral-900 text-green-400 p-2.5 rounded font-mono overflow-x-auto">{installCommand}</pre>
            <button
              class="absolute top-1.5 right-1.5 text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700 hover:text-white"
              onClick={() => handleCopy(installCommand, 'install')}
            >
              {copied === 'install' ? '\u2713 Copied' : 'Copy'}
            </button>
          </div>
          {extId && (
            <p class="text-xs text-neutral-400">
              Your extension ID: <code class="bg-neutral-100 px-1 rounded text-neutral-600">{extId}</code>
            </p>
          )}
        </div>
      </div>

      {/* Step 3: Open your AI tool */}
      <div class="mx-3 mb-3 p-3 rounded border-l-4 border-neutral-200 bg-neutral-50">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-5 h-5 rounded-full text-xs flex items-center justify-center bg-neutral-300 text-white">3</span>
          <span class="text-sm font-medium text-neutral-900">Open Your AI Tool</span>
        </div>
        <div class="ml-7 space-y-2">
          <p class="text-xs text-neutral-600">
            Start any MCP-compatible AI tool. The extension detects it automatically.
          </p>
          <ul class="text-xs text-neutral-500 list-disc list-inside space-y-0.5">
            <li>Claude Code (terminal)</li>
            <li>VS Code with Copilot or Continue</li>
            <li>Cursor</li>
            <li>Windsurf</li>
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
