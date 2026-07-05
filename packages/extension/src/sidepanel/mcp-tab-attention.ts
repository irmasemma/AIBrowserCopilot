import type { VerdictKind, VerdictSeverity } from './connection-verdict.js';

/**
 * Verdict kinds that justify pulling the user's attention to the MCP tab.
 *
 * These are the actionable / degraded states. We deliberately EXCLUDE the
 * benign / in-progress kinds so a chat-only user (or a healthy session) never
 * sees a false alarm:
 *   - 'untested'   → connected but no tool call proven yet; not a problem
 *   - 'connecting' → first-launch handshake in progress; not a problem
 *   - 'working'    → proven healthy
 */
export const ATTENTION_KINDS: ReadonlySet<VerdictKind> = new Set<VerdictKind>([
  'flapping',
  'broken',
  'version_mismatch',
  'stale',
  'degraded',
  'recovering',
  'reconnecting',
  'disconnected',
]);

/**
 * Pure predicate: should the MCP tab show an "attention" badge?
 *
 * Conservative on purpose — three gates must all hold:
 *   1. `hasEngagedMcp` — the user has actually connected MCP at least once
 *      (derived from `connectionContext.lastConnectedAt != null`, NOT
 *      `setupComplete`, which is polluted by the wizard "skip" button). A
 *      brand-new chat-only user has never engaged MCP → never badged.
 *   2. `severity !== 'ok'` — a healthy verdict is never an alarm.
 *   3. `ATTENTION_KINDS.has(kind)` — the kind is one of the actionable
 *      failure/degraded states (excludes untested/connecting/working).
 */
export function mcpTabNeedsAttention(args: {
  hasEngagedMcp: boolean;
  severity: VerdictSeverity;
  kind: VerdictKind;
}): boolean {
  return args.hasEngagedMcp && args.severity !== 'ok' && ATTENTION_KINDS.has(args.kind);
}
