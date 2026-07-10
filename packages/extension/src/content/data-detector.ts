/**
 * Content script: heuristic detection of structured/repeating data on any page.
 * Finds tables, card grids, product listings, search results, etc.
 * Injected via chrome.scripting.executeScript().
 */

export interface DataRegion {
  source: 'html_table' | 'repeating_pattern';
  containerSelector: string;
  headers: string[];
  rows: string[][];
  totalDetected: number;
  confidence: number;
  paginationDetected: boolean;
  nextButtonSelector: string | null;
}

export interface ExtractDataResult {
  regions: DataRegion[];
  bestRegion: DataRegion | null;
}

interface PatternCandidate {
  container: Element;
  items: Element[];
  tag: string;
  className: string;
  score: number;
}

/**
 * Build a usable CSS selector for an element.
 */
function selectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).map(c => CSS.escape(c)).join('.')
    : '';
  const parent = el.parentElement;
  if (parent?.id) return `#${CSS.escape(parent.id)} > ${tag}${cls}`;
  return `${tag}${cls}`;
}

/**
 * Extract text content from a cell, truncated.
 */
function cellText(el: Element, includeLinks: boolean): string {
  if (includeLinks) {
    const link = el.querySelector('a[href]') as HTMLAnchorElement | null;
    if (link) {
      const text = link.textContent?.trim() ?? '';
      return text ? `${text} (${link.href})` : link.href;
    }
  }
  return (el.textContent?.trim() ?? '').slice(0, 500);
}

/**
 * Extract tables (classic HTML path).
 */
function extractTables(
  containerSelector: string | null,
  maxRows: number,
  includeLinks: boolean,
): DataRegion[] {
  const tables = containerSelector
    ? Array.from(document.querySelectorAll(`${containerSelector} table, table${containerSelector}`))
    : Array.from(document.querySelectorAll('table'));

  return tables.map(table => {
    const headerEls = Array.from(table.querySelectorAll('thead th, thead td, tr:first-child th'));
    const headers = headerEls.map(th => th.textContent?.trim() ?? '');

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const allRows = bodyRows.length > 0 ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(headers.length > 0 ? 1 : 0);

    const rows = allRows.slice(0, maxRows).map(tr =>
      Array.from(tr.querySelectorAll('td, th')).map(td => cellText(td, includeLinks)),
    );

    const totalDetected = allRows.length;
    const confidence = headers.length > 0 && rows.length > 1 ? 0.9 : rows.length > 1 ? 0.7 : 0.4;

    return {
      source: 'html_table' as const,
      containerSelector: selectorFor(table),
      headers,
      rows,
      totalDetected,
      confidence,
      paginationDetected: false,
      nextButtonSelector: null,
    };
  });
}

/**
 * Group `container`'s children by a signature and score each group with the
 * SAME structural-consistency + text-density heuristic. `byTagOnly` swaps the
 * grouping key from `tag+className` to `tag` alone — see the fallback-pass
 * comment in `findRepeatingPatterns` for why. Extracted so both passes share
 * identical scoring and can never drift apart.
 */
function scoreGroupsInContainer(
  container: Element,
  byTagOnly: boolean,
  out: PatternCandidate[],
  seen: Set<Element>,
): void {
  const children = Array.from(container.children);
  if (children.length < 3) return;

  const groups = new Map<string, Element[]>();
  for (const child of children) {
    const key = byTagOnly ? child.tagName : `${child.tagName}|${child.className}`;
    const group = groups.get(key);
    if (group) group.push(child);
    else groups.set(key, [child]);
  }

  for (const [key, items] of groups) {
    if (items.length < 3) continue;

    // Structural consistency: check that items have similar child counts
    const childCounts = items.map(item => item.children.length);
    const avgChildren = childCounts.reduce((a, b) => a + b, 0) / childCounts.length;
    const variance = childCounts.reduce((sum, c) => sum + (c - avgChildren) ** 2, 0) / childCounts.length;
    const consistency = avgChildren > 0 ? 1 / (1 + Math.sqrt(variance) / avgChildren) : 0;

    // Data density: average text length per item
    const avgText = items.reduce((sum, item) => sum + (item.textContent?.trim().length ?? 0), 0) / items.length;
    const density = Math.min(avgText / 100, 1); // Normalize to 0-1

    const score = items.length * consistency * density;

    if (score > 2) {
      const [tag, cls] = key.split('|');
      out.push({
        container,
        items,
        tag: tag!,
        className: byTagOnly ? '' : (cls ?? ''),
        score,
      });
      seen.add(container);
    }
  }
}

/**
 * Find repeating sibling patterns (card grids, lists, etc.).
 */
function findRepeatingPatterns(maxRows: number, includeLinks: boolean): PatternCandidate[] {
  const candidates: PatternCandidate[] = [];
  const seen = new Set<Element>();

  // Look for containers with many same-tag, same-class children
  const containers = document.querySelectorAll('ul, ol, div, section, main, article');

  // Pass 1: group by exact tag+className. Works for classic markup where
  // sibling cards share a literal class name (Bootstrap, hand-written CSS).
  for (const container of containers) {
    if (seen.has(container)) continue;
    scoreGroupsInContainer(container, false, candidates, seen);
  }

  // Pass 2 (fallback): if pass 1 found nothing, retry grouping by TAG ONLY,
  // ignoring className. Meta-property sites (Facebook/Instagram/Threads) use
  // atomic/utility CSS (stylex) where classNames are often near-unique per
  // element instance rather than shared identically across sibling cards —
  // exact tag+className grouping then collapses every group to size 1 and
  // never reaches the `items.length < 3` threshold, so structured data that's
  // visibly there (e.g. a Threads feed) is reported as "not found". Reuses
  // the IDENTICAL consistency+density scoring — only the grouping KEY
  // changes, not the quality bar, so this can't loosen what counts as a
  // repeating pattern, only widen how candidates are grouped.
  if (candidates.length === 0) {
    for (const container of containers) {
      scoreGroupsInContainer(container, true, candidates, seen);
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

/**
 * Extract field values from repeated elements, inferring column headers.
 */
function extractFieldsFromPattern(
  items: Element[],
  maxRows: number,
  includeLinks: boolean,
): { headers: string[]; rows: string[][] } {
  // Sample the first few items to find field structure
  const sampleSize = Math.min(items.length, 5);
  const sampleItems = items.slice(0, sampleSize);

  // Find unique selectors within items that consistently contain text
  const fieldSelectors: Array<{ selector: string; label: string }> = [];

  // Collect all distinct child element "paths" in the first item
  const first = sampleItems[0]!;
  const candidates: Element[] = [];

  function collectLeafElements(el: Element, depth: number) {
    if (depth > 6) return;
    const children = Array.from(el.children);
    if (children.length === 0 || (el.textContent?.trim().length ?? 0) < 200) {
      candidates.push(el);
    } else {
      children.forEach(c => collectLeafElements(c, depth + 1));
    }
  }
  collectLeafElements(first, 0);

  // For each candidate child, build a within-item selector and check consistency
  for (const candidate of candidates) {
    const tag = candidate.tagName.toLowerCase();
    const cls = candidate.className && typeof candidate.className === 'string'
      ? '.' + candidate.className.trim().split(/\s+/).filter(Boolean).map(c => CSS.escape(c)).join('.')
      : '';
    const sel = `${tag}${cls}`;

    // Check this selector yields content in most sample items
    let matchCount = 0;
    for (const item of sampleItems) {
      const found = item.querySelector(sel);
      if (found && found.textContent?.trim()) matchCount++;
    }

    if (matchCount >= sampleSize * 0.6 && !fieldSelectors.some(f => f.selector === sel)) {
      // Infer label from tag/class
      const classLabel = (candidate.className && typeof candidate.className === 'string')
        ? candidate.className.trim().split(/\s+/)[0]?.replace(/[-_]/g, ' ')
        : null;
      const label = classLabel || tag;
      fieldSelectors.push({ selector: sel, label: label ?? tag });
    }
  }

  // If we couldn't find sub-structure, just use the whole text of each item
  if (fieldSelectors.length === 0) {
    return {
      headers: ['Content'],
      rows: items.slice(0, maxRows).map(item => [item.textContent?.trim().slice(0, 500) ?? '']),
    };
  }

  const headers = fieldSelectors.map(f => f.label);
  const rows = items.slice(0, maxRows).map(item => {
    return fieldSelectors.map(f => {
      const el = item.querySelector(f.selector);
      return el ? cellText(el, includeLinks) : '';
    });
  });

  return { headers, rows };
}

/**
 * Detect pagination elements on the page.
 */
function detectPagination(): { detected: boolean; selector: string | null } {
  const paginationSelectors = [
    'a[rel="next"]',
    'a[aria-label="Next"]',
    'button[aria-label="Next"]',
    '.pagination a:last-child',
    '.pagination .next',
    '.pager .next',
    'nav[aria-label="pagination"] a:last-child',
    '[class*="next"]:is(a, button)',
    '[class*="Next"]:is(a, button)',
  ];

  for (const sel of paginationSelectors) {
    const el = document.querySelector(sel);
    if (el) return { detected: true, selector: sel };
  }
  return { detected: false, selector: null };
}

/**
 * Main extraction function. Injected as content script.
 */
export function detectAndExtractData(options: {
  selector?: string;
  maxRows?: number;
  includeLinks?: boolean;
  columns?: string[];
}): ExtractDataResult {
  const maxRows = options.maxRows ?? 100;
  const includeLinks = options.includeLinks ?? false;
  const containerSelector = options.selector ?? null;

  // 1. HTML tables
  const tableRegions = extractTables(containerSelector, maxRows, includeLinks);

  // 2. Repeating patterns
  const patterns = findRepeatingPatterns(maxRows, includeLinks);
  const pagination = detectPagination();

  const patternRegions: DataRegion[] = patterns.map(p => {
    const { headers, rows } = extractFieldsFromPattern(p.items, maxRows, includeLinks);
    const confidence = Math.min(p.score / 20, 1); // Normalize score to 0-1

    return {
      source: 'repeating_pattern' as const,
      containerSelector: selectorFor(p.container),
      headers,
      rows,
      totalDetected: p.items.length,
      confidence,
      paginationDetected: pagination.detected,
      nextButtonSelector: pagination.selector,
    };
  });

  // Add pagination info to tables too
  for (const region of tableRegions) {
    region.paginationDetected = pagination.detected;
    region.nextButtonSelector = pagination.selector;
  }

  const allRegions = [...tableRegions, ...patternRegions];

  // Sort by confidence descending
  allRegions.sort((a, b) => b.confidence - a.confidence);

  // If user provided column hints, boost regions that match
  if (options.columns && options.columns.length > 0) {
    const hints = options.columns.map(c => c.toLowerCase());
    for (const region of allRegions) {
      const headerLower = region.headers.map(h => h.toLowerCase());
      const matchCount = hints.filter(h => headerLower.some(rh => rh.includes(h) || h.includes(rh))).length;
      if (matchCount > 0) {
        region.confidence = Math.min(region.confidence + matchCount * 0.1, 1);
      }
    }
    allRegions.sort((a, b) => b.confidence - a.confidence);
  }

  return {
    regions: allRegions,
    bestRegion: allRegions[0] ?? null,
  };
}
