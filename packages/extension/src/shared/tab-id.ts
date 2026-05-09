/**
 * Namespaced tab identifiers for multi-profile fan-out.
 *
 * Chrome's raw tab IDs are integers, monotonic per profile. Two profiles can
 * each have a tab with the same numeric id. To disambiguate, every tabId we
 * surface to MCP clients is namespaced with the source browserId:
 *
 *   "chrome:<uuid>:622786441"
 *
 * Parts:
 *   - browserId  = "chrome:<uuid>"   (everything before the LAST colon)
 *   - rawId      = 622786441         (the integer chrome.tabs ID)
 *
 * See docs/multi-profile-tab-fanout-design.md.
 */

/**
 * Compose a namespaced tab id.
 */
export function composeTabId(browserId: string, rawId: number): string {
  return `${browserId}:${rawId}`;
}

export interface ParsedTabId {
  browserId: string;
  rawId: number;
}

/**
 * Parse a tab id that may be:
 *   - a namespaced string  ("chrome:abc:622786441")
 *   - a raw int / numeric string ("622786441" or 622786441)  → legacy form
 *
 * For raw ints, browserId is "" — the bridge interprets this as
 * "use the only connected browser" and the extension routes locally.
 *
 * Returns null if the input cannot be parsed as a tab id at all.
 */
export function parseTabId(input: unknown): ParsedTabId | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return { browserId: '', rawId: Math.trunc(input) };
  }

  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s.length === 0) return null;

  // Bare numeric string — legacy raw id
  if (/^[0-9]+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return { browserId: '', rawId: n };
  }

  // Namespaced. Split on the LAST colon (browserId may contain its own colon
  // because composite ids are "chrome:<uuid>" → final shape is
  // "chrome:<uuid>:<rawId>").
  const lastColon = s.lastIndexOf(':');
  if (lastColon === -1 || lastColon === s.length - 1) return null;

  const browserId = s.slice(0, lastColon);
  const rawStr = s.slice(lastColon + 1);
  if (!/^[0-9]+$/.test(rawStr)) return null;
  const rawId = Number(rawStr);
  if (!Number.isFinite(rawId)) return null;

  return { browserId, rawId };
}
