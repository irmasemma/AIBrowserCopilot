import type { FunctionalComponent } from 'preact';
import { PermissionToggle } from './permission-toggle.js';

interface ToolCardProps {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  enabled: boolean;
  onToggle: () => void;
}

export const ToolCard: FunctionalComponent<ToolCardProps> = ({
  displayName, description, icon, enabled, onToggle,
}) => {
  return (
    <div class="flex items-center gap-3 px-3 py-2.5">
      <span class="text-base leading-none flex-shrink-0" aria-hidden="true">{icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm text-neutral-900 truncate">{displayName}</div>
        <div class="text-[11px] text-neutral-500 truncate">{description}</div>
      </div>
      <PermissionToggle
        enabled={enabled}
        onToggle={onToggle}
        label={displayName}
      />
    </div>
  );
};
