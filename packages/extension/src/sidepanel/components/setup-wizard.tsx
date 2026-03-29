import type { FunctionalComponent } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { SetupStep } from './setup-step.js';
import { ErrorCard } from './error-card.js';
import { generateClaudeConfig, getClaudeConfigPath, getNativeHostInstallDir } from '../../setup/config-generator.js';
import { trackSetupEvent } from '../../setup/telemetry.js';

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3;
type StepStatus = 'pending' | 'active' | 'complete' | 'error';

const GITHUB_RELEASES_URL = 'https://github.com/irmasemma/AIBrowserCopilot/releases/latest';

export const SetupWizard: FunctionalComponent<SetupWizardProps> = ({ onComplete }) => {
  const [_currentStep, setCurrentStep] = useState<Step>(1);
  const [stepStatuses, setStepStatuses] = useState<Record<Step, StepStatus>>({
    1: 'active', 2: 'pending', 3: 'pending',
  });
  const [error, setError] = useState<string | null>(null);
  const [configJson, setConfigJson] = useState('');
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    trackSetupEvent('setup_started');
    const installDir = getNativeHostInstallDir();
    const config = generateClaudeConfig(`${installDir}/dist/index.js`);
    setConfigJson(JSON.stringify(config, null, 2));
  }, []);

  const completeStep = (step: Step) => {
    setStepStatuses((prev) => ({ ...prev, [step]: 'complete' }));
    const next = (step + 1) as Step;
    if (next <= 3) {
      setStepStatuses((prev) => ({ ...prev, [next]: 'active' }));
      setCurrentStep(next);
    }
  };

  const handleCopyConfig = async () => {
    await navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    trackSetupEvent('first_connection');
    // Check if relay port is set (indicates native host is running)
    const data = await chrome.storage.local.get('connectionState');
    const state = data.connectionState;
    if (state?.state === 'connected') {
      completeStep(3);
      onComplete();
    } else {
      setError('Connection test failed. Make sure Claude Desktop is running and has loaded the MCP config.');
    }
  };

  const handleEmailCapture = async () => {
    if (!email) return;
    await chrome.storage.local.set({ setupFailEmail: email });
    setEmail('');
    setError(null);
  };

  const getStepStatus = (step: Step): StepStatus => stepStatuses[step];

  return (
    <div class="py-4">
      <div class="px-3 mb-4">
        <h2 class="text-lg font-semibold text-neutral-900">Setup Assistant</h2>
        <p class="text-xs text-neutral-500">Connect your browser to your AI assistant</p>
      </div>

      {/* Step 1: Install Native Host */}
      <SetupStep step={1} totalSteps={3} title="Install Browser Bridge" status={getStepStatus(1)}>
        <div class="space-y-2">
          <p class="text-xs text-neutral-600">
            Download the browser bridge for your platform. This small program runs locally and connects your browser to your AI.
          </p>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener"
            class="inline-block text-xs font-medium text-white bg-brand-primary px-3 py-1.5 rounded hover:bg-brand-primary-dark"
            onClick={() => trackSetupEvent('bridge_download_started')}
          >
            Download Bridge
          </a>
          <p class="text-xs text-neutral-400">
            Extract to: <code class="bg-neutral-100 px-1 rounded">{getNativeHostInstallDir()}</code>
          </p>
          <button
            class="text-xs text-brand-primary hover:underline"
            onClick={() => { trackSetupEvent('bridge_registered'); completeStep(1); }}
          >
            I've installed it → Continue
          </button>
        </div>
      </SetupStep>

      {/* Step 2: Configure Claude Desktop */}
      <SetupStep step={2} totalSteps={3} title="Configure AI App" status={getStepStatus(2)}>
        <div class="space-y-2">
          <p class="text-xs text-neutral-600">
            Add this to your Claude Desktop config file:
          </p>
          <p class="text-xs text-neutral-400">
            File: <code class="bg-neutral-100 px-1 rounded">{getClaudeConfigPath()}</code>
          </p>
          <div class="relative">
            <pre class="text-xs bg-neutral-100 p-2 rounded overflow-x-auto max-h-32">{configJson}</pre>
            <button
              class="absolute top-1 right-1 text-xs text-brand-primary bg-white px-2 py-0.5 rounded border border-neutral-200"
              onClick={handleCopyConfig}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <p class="text-xs text-neutral-400">
            Restart Claude Desktop after saving the config.
          </p>
          <button
            class="text-xs text-brand-primary hover:underline"
            onClick={() => { trackSetupEvent('ai_host_detected'); completeStep(2); }}
          >
            Done — I've updated the config → Continue
          </button>
        </div>
      </SetupStep>

      {/* Step 3: Test Connection */}
      <SetupStep step={3} totalSteps={3} title="Test Connection" status={getStepStatus(3)}>
        <div class="space-y-2">
          <p class="text-xs text-neutral-600">
            Let's verify everything is connected. Make sure Claude Desktop is running.
          </p>
          <button
            class="text-xs font-medium text-white bg-brand-primary px-3 py-1.5 rounded hover:bg-brand-primary-dark"
            onClick={handleTestConnection}
          >
            Test Connection
          </button>
        </div>
      </SetupStep>

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
