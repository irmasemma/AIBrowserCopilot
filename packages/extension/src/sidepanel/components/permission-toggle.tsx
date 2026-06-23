import type { FunctionalComponent } from 'preact';

interface PermissionToggleProps {
  enabled: boolean;
  onToggle: () => void;
  label: string;
}

export const PermissionToggle: FunctionalComponent<PermissionToggleProps> = ({ enabled, onToggle, label }) => {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={`${label}: ${enabled ? 'enabled' : 'disabled'}`}
      class={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-status-connected' : 'bg-neutral-300'}`}
      onClick={onToggle}
    >
      <span
        class={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
};
