import type { FunctionalComponent } from 'preact';

interface PermissionToggleProps {
  enabled: boolean;
  locked?: boolean;
  onToggle: () => void;
  label: string;
}

export const PermissionToggle: FunctionalComponent<PermissionToggleProps> = ({ enabled, locked, onToggle, label }) => {
  if (locked) {
    return (
      <span class="text-xs text-pro-locked font-medium px-2 py-0.5 bg-neutral-100 rounded" aria-label={`${label}: Pro required`}>
        🔒 PRO
      </span>
    );
  }

  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={`${label}: ${enabled ? 'enabled' : 'disabled'}`}
      class={`relative w-8 h-4 rounded-full transition-colors ${enabled ? 'bg-status-connected' : 'bg-neutral-300'}`}
      onClick={onToggle}
    >
      <span
        class={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${enabled ? 'left-4' : 'left-0.5'}`}
      />
    </button>
  );
};
