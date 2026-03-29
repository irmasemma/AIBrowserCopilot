import type { FunctionalComponent } from 'preact';
import { PermissionToggle } from './permission-toggle.js';

interface ToolCardProps {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  tier: 'free' | 'pro';
  enabled: boolean;
  hasLicense: boolean;
  onToggle: () => void;
}

export const ToolCard: FunctionalComponent<ToolCardProps> = ({
  displayName, description, icon, tier, enabled, hasLicense, onToggle,
}) => {
  const isLocked = tier === 'pro' && !hasLicense;

  return (
    <div class={`flex items-center gap-2 px-3 py-2 rounded ${isLocked ? 'opacity-60' : ''}`}>
      <span class="text-base" aria-hidden="true">{icon}</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-neutral-900 truncate">{displayName}</div>
        <div class="text-xs text-neutral-500 truncate">{description}</div>
      </div>
      <PermissionToggle
        enabled={enabled && !isLocked}
        locked={isLocked}
        onToggle={onToggle}
        label={displayName}
      />
    </div>
  );
};
