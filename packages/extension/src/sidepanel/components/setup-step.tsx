import type { FunctionalComponent, ComponentChildren } from 'preact';

interface SetupStepProps {
  step: number;
  totalSteps: number;
  title: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  children: ComponentChildren;
}

const statusStyles: Record<string, string> = {
  pending: 'border-neutral-200 bg-neutral-50',
  active: 'border-brand-primary bg-white',
  complete: 'border-status-connected bg-white',
  error: 'border-status-disconnected bg-white',
};

const stepIndicatorStyles: Record<string, string> = {
  pending: 'bg-neutral-300 text-white',
  active: 'bg-brand-primary text-white',
  complete: 'bg-status-connected text-white',
  error: 'bg-status-disconnected text-white',
};

export const SetupStep: FunctionalComponent<SetupStepProps> = ({ step, totalSteps, title, status, children }) => {
  return (
    <div
      class={`mx-3 mb-3 p-3 rounded border-l-4 ${statusStyles[status]}`}
      role="region"
      aria-label={`Step ${step} of ${totalSteps}: ${title}`}
      aria-current={status === 'active' ? 'step' : undefined}
    >
      <div class="flex items-center gap-2 mb-2">
        <span class={`w-5 h-5 rounded-full text-xs flex items-center justify-center ${stepIndicatorStyles[status]}`}>
          {status === 'complete' ? '✓' : step}
        </span>
        <span class="text-sm font-medium text-neutral-900">{title}</span>
        <span class="text-xs text-neutral-400 ml-auto">Step {step}/{totalSteps}</span>
      </div>
      {(status === 'active' || status === 'error') && (
        <div class="ml-7">{children}</div>
      )}
    </div>
  );
};
