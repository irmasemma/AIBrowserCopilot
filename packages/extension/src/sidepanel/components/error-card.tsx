import type { FunctionalComponent } from 'preact';

interface ErrorCardProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  helpUrl?: string;
}

export const ErrorCard: FunctionalComponent<ErrorCardProps> = ({ message, actionLabel, onAction, helpUrl }) => {
  return (
    <div class="mx-3 my-2 p-3 rounded border-l-4 border-status-disconnected bg-white" role="alert">
      <p class="text-sm text-neutral-700 mb-2">{message}</p>
      <div class="flex gap-2">
        {actionLabel && onAction && (
          <button
            class="text-xs font-medium text-white bg-brand-primary px-3 py-1 rounded hover:bg-brand-primary-dark"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
        {helpUrl && (
          <a
            href={helpUrl}
            target="_blank"
            rel="noopener"
            class="text-xs text-brand-primary hover:underline py-1"
          >
            Help
          </a>
        )}
      </div>
    </div>
  );
};
