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
    <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 transition-colors">
      <span class="text-lg leading-none flex-shrink-0" aria-hidden="true">{icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-neutral-900 truncate">{displayName}</div>
        <div class="text-xs text-neutral-500 truncate">{description}</div>
      </div>
      <PermissionToggle
        enabled={enabled}
        onToggle={onToggle}
        label={displayName}
      />
    </div>
  );
};
