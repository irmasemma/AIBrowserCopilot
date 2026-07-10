import type { ActivityEntry } from '../shared/types.js';
import { MAX_ACTIVITY_LOG_SIZE } from '../shared/constants.js';
import { isBlockedDomain } from '../shared/domain-blocklist.js';
import { withPlaywrightPage } from './playwright-bridge.js';
import type { Page } from 'playwright-crx/test';
import { readFormFields } from '../content/form-reader.js';
import { detectAndExtractData } from '../content/data-detector.js';
import { getBrowserInstanceId } from '../shared/browser-instance-id.js';
import { composeTabId, parseTabId } from '../shared/tab-id.js';
import { logRecord, logError } from '../shared/logger.js';

/**
 * Walk the DOM, assign a stable `data-ai-ref="eN"` to every interactive
 * element, and emit a compact YAML-like list of those elements plus the
 * page's accessibility snapshot. The refs let the LLM target a specific
 * element unambiguously via `page.locator('[data-ai-ref="eN"]')`.
 *
 * Inspired by BrowserMCP/mcp's snapshot+ref pattern, adapted for our
 * Playwright 1.58.2 runtime (which lacks `ariaSnapshot({ ref: true })`).
 */
const SNAPSHOT_REF_INJECTOR = `(() => {
  const SELECTOR = [
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'button',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
  ].join(',');

  const ROLE_FROM_TAG = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'file') return 'file';
      if (t === 'range') return 'slider';
      return 'textbox';
    }
    return tag;
  };

  const ACC_NAME = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\\s+/).filter(Boolean);
      const text = ids
        .map(id => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    if (el.id) {
      const labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      const t = labelEl?.textContent?.trim();
      if (t) return t;
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach(c => c.remove());
      const t = clone.textContent?.trim();
      if (t) return t;
    }
    if (el.placeholder) return el.placeholder;
    if (el.title) return el.title;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      const t = el.textContent?.trim();
      if (t) return t.slice(0, 80);
    }
    if (el.value && el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) {
      return el.value;
    }
    return '';
  };

  const STATE = (el) => {
    const parts = [];
    if (el.disabled) parts.push('disabled');
    if (el.required) parts.push('required');
    if (el.readOnly) parts.push('readonly');
    if (el.checked) parts.push('checked');
    const aria = (a) => el.getAttribute(a);
    if (aria('aria-checked') === 'true') parts.push('checked');
    if (aria('aria-selected') === 'true') parts.push('selected');
    if (aria('aria-expanded') === 'true') parts.push('expanded');
    if (aria('aria-invalid') === 'true') parts.push('invalid');
    if (el.tagName === 'INPUT' && el.value && el.type !== 'password') {
      const v = String(el.value).slice(0, 40);
      parts.push('value=' + JSON.stringify(v));
    }
    return parts.length ? ' ' + parts.join(' ') : '';
  };

  const IS_VISIBLE = (el) => {
    if (!el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return true;
  };

  document.querySelectorAll('[data-ai-ref]').forEach(el => el.removeAttribute('data-ai-ref'));

  const lines = [];
  let counter = 0;
  const elements = document.querySelectorAll(SELECTOR);
  for (const el of elements) {
    if (!IS_VISIBLE(el)) continue;
    const ref = 'e' + (++counter);
    el.setAttribute('data-ai-ref', ref);
    const role = ROLE_FROM_TAG(el);
    const name = ACC_NAME(el).replace(/"/g, '\\\\"').slice(0, 80);
    lines.push('- ' + role + ' "' + name + '" [ref=' + ref + ']' + STATE(el));
  }
  return lines.join('\\n');
})()`;

// Bounded timeout for fill_form field actions (fill/check/select/setInputFiles)
// so a slow/ambiguous locator fails fast per-field instead of waiting out the
// Playwright default (~30s) — same "no unbounded locator op" rule as click/press.
const FIELD_OPTS = { timeout: 8_000 };

// ── Ref-liveness classification (corrected Fix B) ───────────────────────────
//
// THE INVARIANT: `data-ai-ref` is a positional attribute stamped onto live
// DOM nodes at snapshot time (see SNAPSHOT_REF_INJECTOR above). ANY DOM
// mutation between snapshot and action can destroy the node a ref points to —
// our own diag dashboard's 1.5s poll does this, and so does ordinary SPA
// re-rendering (Google Analytics, React/Angular apps). When that happens,
// `page.locator('[data-ai-ref="eN"]')` resolves to zero elements and the
// existing bounded 8s `.click()`/`.press()`/`.fill()` throws a generic
// Playwright timeout with no distinguishing errorCode.
//
// THE ONE HARD RULE: classification runs ONLY inside a catch block, AFTER the
// real, unmodified, full-budget auto-waiting action has already thrown.
// Playwright auto-waits for the target to attach/become-actionable across the
// ENTIRE timeout window; a bare `locator.count()` does NOT wait at all.
// Running count() BEFORE the action (or using it to shorten the wait) would
// misclassify a legitimately-slow-but-successful render (attaches at +300ms,
// async fetch resolving at +2s, etc. — well inside the 8s budget) as an
// instant, incorrect failure. Every helper below is therefore only ever
// called from a `catch`, never before or in place of the real action.

type ClassifiedCode = 'REF_STALE' | 'CLICK_NOT_ACTIONABLE' | 'AMBIGUOUS_REF';

/** Minimal identity fingerprint for an element, from the same accessible-name
 * text the ref-injector writes into its YAML lines (`- button "Save" [ref=e12]`). */
interface RefFingerprint {
  role: string;
  name: string;
}

/** Per-tab fingerprints handed out by the MOST RECENT snapshot/ref-injection.
 * Replaced wholesale on every injector run (never merged) because the injector
 * itself wipes and reassigns every `data-ai-ref` from scratch each time. A tab
 * with no entry yields `undefined` lookups; every caller treats that as
 * "nothing to verify against" and degrades to a plain REF_STALE, never a crash. */
const refFingerprintCache = new Map<number, Map<string, RefFingerprint>>();

/** Parse the ref-injector's output lines into a ref → fingerprint map. Single
 * source of truth for the line format, shared by the cache-populating snapshot
 * and the stale-ref retry so they can never drift apart. */
function parseRefFingerprints(refLines: string): Map<string, RefFingerprint> {
  const out = new Map<string, RefFingerprint>();
  if (!refLines) return out;
  const LINE_RE = /^- (\S+) "((?:[^"\\]|\\.)*)" \[ref=(e\d+)\]/;
  for (const line of refLines.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, role, name, ref] = m;
    out.set(ref, { role, name });
  }
  return out;
}

/** Loose match for the case-4 identity-warning comparison (evaluateHandle's
 * probe exposes `text`, not `role`/`name`, so this compares on accessible text
 * tolerantly and never false-alarms when there's nothing to compare). */
function fingerprintsRoughlyMatch(
  expected: RefFingerprint,
  actual: { role?: string; text?: string },
): boolean {
  if (!actual.text) return true;
  return expected.name === actual.text || expected.name.startsWith(actual.text.slice(0, 40));
}

/** Post-hoc, INSTANT classification of why a bounded locator action just
 * failed. MUST be called only from a catch block (see the invariant above).
 * Returns null if the check itself couldn't complete (page navigated/closed) —
 * callers MUST fall back to the original error, never invent a new failure. */
async function classifyLocatorFailure(
  locator: { count(): Promise<number> },
): Promise<ClassifiedCode | null> {
  try {
    const count = await locator.count();
    if (count === 0) return 'REF_STALE';
    if (count === 1) return 'CLICK_NOT_ACTIONABLE';
    return 'AMBIGUOUS_REF';
  } catch {
    return null;
  }
}

/** Wrap a classified failure as an Error carrying the existing `{code}`
 * convention (see TAB_NOT_FOUND / DOMAIN_BLOCKED / CONTENT_UNAVAILABLE) so
 * redaction.ts's redactError() emits `errorCode` like every other tool
 * failure. `cause` preserves the original error for local debugging (redaction
 * ignores it). */
function toClassifiedError(code: ClassifiedCode, original: unknown): Error {
  const message = original instanceof Error ? original.message : String(original);
  // Prefix the machine code into the MESSAGE so it survives the bridge's
  // translateExtensionResponse (which forwards only error.message, not .code)
  // and reaches the MCP client's response text — letting the caller distinguish
  // REF_STALE (re-snapshot & retry) from CLICK_NOT_ACTIONABLE (blocked/wait).
  // The `code` property is still set for logs/activity + the ext→bridge frame.
  return Object.assign(new Error(`${code}: ${message}`), { code, cause: original });
}

/** Sentinel thrown by performFieldAction to mean "a validation branch already
 * pushed its own result; the caller should `continue`, not treat this as a
 * real action failure." Preserves the original inline switch's bare-`continue`
 * control flow. */
const FIELD_SKIPPED = Symbol('field-skipped');

/** The exact body of fill_form's original inline switch, extracted verbatim so
 * it can be replayed against a freshly re-resolved locator on a stale-ref retry
 * without duplicating logic. `fieldResults`/`fieldId` are used only by the
 * validation branches that push a failure directly (matching the original's
 * `continue` via FIELD_SKIPPED). */
async function performFieldAction(
  locator: { selectOption: Function; check: Function; uncheck: Function; setInputFiles: Function; fill: Function },
  effectiveType: string,
  detected: { multiple: boolean },
  field: { values?: string[]; checked?: boolean },
  valueStr: string,
  fieldId: string,
  fieldResults: Array<{ field: string; success: boolean; error?: string; errorCode?: string }>,
): Promise<void> {
  switch (effectiveType) {
    case 'select': {
      const opts = field.values ?? (valueStr ? [valueStr] : []);
      if (opts.length === 0) {
        fieldResults.push({ field: fieldId, success: false, error: 'select requires `value` or `values`' });
        throw FIELD_SKIPPED;
      }
      await locator.selectOption(detected.multiple ? opts : opts[0], FIELD_OPTS);
      break;
    }
    case 'checkbox': {
      const truthy = field.checked ?? /^(true|on|yes|1|checked)$/i.test(valueStr);
      if (truthy) await locator.check(FIELD_OPTS);
      else await locator.uncheck(FIELD_OPTS);
      break;
    }
    case 'radio': {
      if (field.checked === false) {
        fieldResults.push({ field: fieldId, success: false, error: 'radio cannot be unchecked; check a sibling radio instead' });
        throw FIELD_SKIPPED;
      }
      await locator.check(FIELD_OPTS);
      break;
    }
    case 'file':
      await locator.setInputFiles(field.values ?? valueStr, FIELD_OPTS);
      break;
    default:
      await locator.fill(valueStr, FIELD_OPTS);
      break;
  }
}

/** Called ONLY from click_element's catch, after the real 8s `.click()` has
 * already thrown. Classifies; for a REF_STALE ref-based click, attempts exactly
 * one identity-verified re-resolve-and-retry (unique role+name match to the
 * snapshot fingerprint — NEVER by index) before giving up. Returns normally iff
 * the retry recovered; otherwise throws a classified error, or the untouched
 * original if classification itself failed. */
async function classifyAndMaybeRetryClick(opts: {
  page: Page;
  tabId: number;
  locator: { count(): Promise<number> };
  ref: string | null;
  originalError: unknown;
}): Promise<void> {
  const code = await classifyLocatorFailure(opts.locator);
  if (code === null) throw opts.originalError; // diagnostic itself failed — never invent a new failure

  if (code !== 'REF_STALE' || !opts.ref) {
    throw toClassifiedError(code, opts.originalError);
  }

  const expected = refFingerprintCache.get(opts.tabId)?.get(opts.ref);
  if (!expected) throw toClassifiedError('REF_STALE', opts.originalError);

  let retryRef: string | null = null;
  try {
    const refLines = (await opts.page.evaluate(SNAPSHOT_REF_INJECTOR)) as string;
    const fresh = parseRefFingerprints(refLines);
    refFingerprintCache.set(opts.tabId, fresh);
    const matches = [...fresh.entries()].filter(
      ([, fp]) => fp.role === expected.role && fp.name === expected.name,
    );
    if (matches.length === 1) retryRef = matches[0][0];
  } catch {
    // Re-injection failed (page mid-navigation/context destroyed) — fall to REF_STALE.
  }

  void logRecord({
    event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'click_element',
    originalRef: opts.ref, retryRef, outcome: retryRef ? 'attempting' : 'no_unique_match',
  });

  if (!retryRef) throw toClassifiedError('REF_STALE', opts.originalError);

  try {
    // NEVER retry by index — only by the freshly re-derived ref that uniquely
    // matched the ORIGINAL element's role+name. This is what stops this retry
    // from becoming the silent-wrong-click bug it's meant to guard against.
    await opts.page.locator(`[data-ai-ref="${retryRef}"]`).click({ timeout: 8_000 });
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'info', toolName: 'click_element', originalRef: opts.ref, retryRef, outcome: 'succeeded' });
    return;
  } catch {
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'click_element', originalRef: opts.ref, retryRef, outcome: 'retry_failed' });
    throw toClassifiedError('REF_STALE', opts.originalError);
  }
}

/** Same contract as classifyAndMaybeRetryClick, replaying `.press(key, opts)`. */
async function classifyAndMaybeRetryPress(opts: {
  page: Page;
  tabId: number;
  locator: { count(): Promise<number> };
  ref: string;
  key: string;
  pressOpts: { timeout: number; noWaitAfter: boolean };
  originalError: unknown;
}): Promise<void> {
  const code = await classifyLocatorFailure(opts.locator);
  if (code === null) throw opts.originalError;
  if (code !== 'REF_STALE') throw toClassifiedError(code, opts.originalError);

  const expected = refFingerprintCache.get(opts.tabId)?.get(opts.ref);
  if (!expected) throw toClassifiedError('REF_STALE', opts.originalError);

  let retryRef: string | null = null;
  try {
    const refLines = (await opts.page.evaluate(SNAPSHOT_REF_INJECTOR)) as string;
    const fresh = parseRefFingerprints(refLines);
    refFingerprintCache.set(opts.tabId, fresh);
    const matches = [...fresh.entries()].filter(
      ([, fp]) => fp.role === expected.role && fp.name === expected.name,
    );
    if (matches.length === 1) retryRef = matches[0][0];
  } catch { /* fall through to REF_STALE */ }

  void logRecord({
    event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'press_key',
    originalRef: opts.ref, retryRef, outcome: retryRef ? 'attempting' : 'no_unique_match',
  });
  if (!retryRef) throw toClassifiedError('REF_STALE', opts.originalError);

  try {
    await opts.page.locator(`[data-ai-ref="${retryRef}"]`).press(opts.key, opts.pressOpts);
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'info', toolName: 'press_key', originalRef: opts.ref, retryRef, outcome: 'succeeded' });
    return;
  } catch {
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'press_key', originalRef: opts.ref, retryRef, outcome: 'retry_failed' });
    throw toClassifiedError('REF_STALE', opts.originalError);
  }
}

/** Same contract as the click/press retries: one bounded, identity-verified
 * replay on REF_STALE, never by index. Returns true iff the retry succeeded. */
async function attemptStaleRefRetryForField(opts: {
  page: Page;
  tabId: number;
  ref: string;
  effectiveType: string;
  detected: { tag: string; type: string; multiple: boolean; ce: boolean };
  field: { values?: string[]; checked?: boolean };
  valueStr: string;
}): Promise<boolean> {
  const expected = refFingerprintCache.get(opts.tabId)?.get(opts.ref);
  if (!expected) return false;

  let retryRef: string | null = null;
  try {
    const refLines = (await opts.page.evaluate(SNAPSHOT_REF_INJECTOR)) as string;
    const fresh = parseRefFingerprints(refLines);
    refFingerprintCache.set(opts.tabId, fresh);
    const matches = [...fresh.entries()].filter(
      ([, fp]) => fp.role === expected.role && fp.name === expected.name,
    );
    if (matches.length === 1) retryRef = matches[0][0];
  } catch { /* fall through */ }

  void logRecord({
    event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'fill_form',
    originalRef: opts.ref, retryRef, outcome: retryRef ? 'attempting' : 'no_unique_match',
  });
  if (!retryRef) return false;

  try {
    const retryLocator = opts.page.locator(`[data-ai-ref="${retryRef}"]`);
    const dummyResults: Array<{ field: string; success: boolean; error?: string; errorCode?: string }> = [];
    await performFieldAction(retryLocator, opts.effectiveType, opts.detected, opts.field, opts.valueStr, `ref=${opts.ref}`, dummyResults);
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'info', toolName: 'fill_form', originalRef: opts.ref, retryRef, outcome: 'succeeded' });
    return true;
  } catch {
    void logRecord({ event: 'ext.tool.dispatch.stale_ref_retry', lvl: 'warn', toolName: 'fill_form', originalRef: opts.ref, retryRef, outcome: 'retry_failed' });
    return false;
  }
}

// Service-worker-safe binary → base64 (no Node Buffer in MV3). Chunked to
// avoid blowing the call stack on large (multi-hundred-KB) screenshots.
const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const captureSnapshot = async (tabId: number): Promise<string> => {
  try {
    return await withPlaywrightPage(tabId, async (page: Page) => {
      // If a mutating tool (e.g. a navigating click) just changed the page, the
      // new DOM may not be ready yet — snapshotting immediately yields nothing
      // (the empty-snapshot-after-navigation gap). Wait, BOUNDED + best-effort,
      // for the new document so the refs reflect the post-action page. On an
      // already-loaded page this returns instantly, so non-navigating tools are
      // not slowed.
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { /* best-effort */ });
      const refLines = await page.evaluate(SNAPSHOT_REF_INJECTOR).catch(() => '') as string;
      // Keep the identity cache in lockstep with every ref-minting event — this
      // IS the snapshot, so it's the only correct place to record what each ref
      // pointed to when minted (used by the stale-ref retry/identity checks).
      refFingerprintCache.set(tabId, parseRefFingerprints(refLines));
      let aria = '';
      try {
        const body = page.locator('body');
        if (typeof (body as any).ariaSnapshot === 'function') {
          aria = await (body as any).ariaSnapshot({ timeout: 5000 }) as string;
        }
      } catch { /* aria snapshot best-effort */ }

      const refSection = refLines
        ? '# Interactive elements (use [ref=eN] in fill_form, click_element, press_key)\n' + refLines
        : '';
      const ariaSection = aria
        ? '\n\n# Page structure\n' + (aria.length > 4000 ? aria.slice(0, 4000) + '\n... (truncated)' : aria)
        : '';
      const out = (refSection + ariaSection).trim();
      return out.length > 6000 ? out.slice(0, 6000) + '\n... (truncated)' : out;
    });
  } catch {
    return '';
  }
};

/** Append an ARIA snapshot to a tool result */
const withSnapshot = async (
  tabId: number,
  result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> },
): Promise<typeof result> => {
  const snapshot = await captureSnapshot(tabId);
  if (!snapshot) {
    // Empty snapshot almost always means the action navigated and the
    // destination is still loading (its JS context is mid-rebuild, so the ref
    // injector finds nothing yet). Returning no refs is the SAFE choice — never
    // emit stale pre-navigation refs. Tell the caller so it fetches the fresh
    // page next turn instead of assuming the snapshot was simply empty.
    result.content.push({
      type: 'text',
      text: '\n--- Page Snapshot ---\n(unavailable — the page is still loading after this action; call get_page_content or take_screenshot on the next step to see the updated page.)',
    });
    return result;
  }
  result.content.push({
    type: 'text',
    text: `\n--- Page Snapshot ---\n\`\`\`yaml\n${snapshot}\n\`\`\``,
  });
  return result;
};

const logActivity = async (entry: ActivityEntry): Promise<void> => {
  const data = await chrome.storage.local.get('activityLog');
  const log: ActivityEntry[] = data.activityLog ?? [];
  log.unshift(entry);
  if (log.length > MAX_ACTIVITY_LOG_SIZE) log.length = MAX_ACTIVITY_LOG_SIZE;
  await chrome.storage.local.set({ activityLog: log });

  // Notify side panel for real-time update
  chrome.runtime.sendMessage({ type: 'activity_update', entry }).catch(() => {
    // Side panel may not be open — ignore
  });
};

/**
 * Resolve a `tab_id` parameter (which may be a raw int from a legacy caller
 * or a namespaced string like "chrome:abc:622786441") to a `chrome.tabs.Tab`.
 *
 * Namespaced ids are produced by `list_tabs` and are how the LLM references
 * a specific tab across profile/browser boundaries. The bridge routes the
 * call to the right extension based on the prefix; by the time we reach
 * here, the rawId is what `chrome.tabs.get()` needs.
 *
 * Active-tab fallback was removed: with multiple windows or profiles, the
 * "current window" semantics silently re-targeted mid-task when the user
 * switched windows. Callers must now pass an explicit `tab_id`. The side
 * panel chat captures-and-binds the active tab at message-send time and
 * passes it explicitly; external MCP clients must call `list_tabs` first.
 */
const getTab = async (tabIdParam: unknown, checkBlocked = true): Promise<chrome.tabs.Tab> => {
  const parsed = parseTabId(tabIdParam);
  if (!parsed || parsed.rawId === 0) {
    throw Object.assign(
      new Error('tab_id is required. Call list_tabs first to get a tab id.'),
      { code: 'TAB_NOT_FOUND' },
    );
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(parsed.rawId);
  } catch {
    throw Object.assign(
      new Error(`Tab ${parsed.rawId} not found — it may have been closed.`),
      { code: 'TAB_NOT_FOUND' },
    );
  }

  if (checkBlocked && tab.url && isBlockedDomain(tab.url)) {
    throw Object.assign(new Error('That site is blocked for your protection'), { code: 'DOMAIN_BLOCKED' });
  }
  return tab;
};

const executeContentScript = async <T>(tabId: number, func: () => T): Promise<T> => {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Chrome/Edge emits this exact wording when the user has set per-tab
    // "Site access: On click" (the default for sideloaded unpacked extensions),
    // even though the manifest declares <all_urls>. Translate it into an
    // actionable instruction so MCP clients (VS Code, Claude, etc.) can
    // surface it to the user.
    if (/Cannot access contents of the page|Extension manifest must request permission/i.test(message)) {
      // Surface a UI signal for the side panel banner — but ONLY if the
      // <all_urls> permission isn't already granted. If it IS granted and
      // we're STILL hitting this error, it's a per-tab issue (e.g., the
      // tab's URL doesn't match any granted origin, or Edge's per-extension
      // runtime "Site access" override is still in "On click" mode for
      // this specific tab). Setting the banner flag in those cases would
      // make the banner re-appear after the user already clicked grant,
      // which is the bug we're fixing.
      try {
        const allUrlsGranted = await chrome.permissions
          .contains({ origins: ['<all_urls>'] })
          .catch(() => false);
        if (!allUrlsGranted) {
          await chrome.storage.local.set({ siteAccessBlocked: true, siteAccessBlockedAt: Date.now() });
        }
      } catch {
        // best-effort; ignore storage errors
      }
      throw Object.assign(
        new Error(
          'This tab is blocked by the browser\'s per-extension Site Access setting. ' +
          'Open the AgentHub side panel and click "Grant access to all sites", ' +
          'or open edge://extensions, click "Details" on AgentHub, and set ' +
          '"Site access" to "On all sites". Then retry.',
        ),
        { code: 'SITE_ACCESS_BLOCKED' },
      );
    }
    throw err;
  }
  if (!results?.[0]) throw Object.assign(new Error('Content script returned no result'), { code: 'CONTENT_UNAVAILABLE' });
  return results[0].result as T;
};

// Tool implementations
const tools: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  async get_page_content(params) {
    const tab = await getTab(params.tab_id as number | undefined);
    const format = (params.format as string) ?? 'text';
    // Pagination (AD-40 / Threads infinite-scroll incident): a page can accumulate
    // hundreds of KB of text (infinite-scroll feeds) — returning it verbatim is what
    // blew a real MCP client's 200k-token context window (403,154 chars in one tool
    // result). offset/max_chars let the model page through instead of always getting
    // everything from byte 0. Default max_chars mirrors TOOL_RESULT_MAX_CHARS (the
    // same-value backstop cap dispatchTool applies to EVERY tool's output below), so
    // an unpaginated call already comes back pre-windowed instead of relying solely
    // on the backstop's generic truncation marker.
    const offset = Math.max(0, Math.trunc((params.offset as number) ?? 0));
    const maxChars = Math.max(1, Math.trunc((params.max_chars as number) ?? TOOL_RESULT_MAX_CHARS));
    // Clamp the EFFECTIVE window unconditionally (not just when max_chars is
    // omitted) so `windowed + scrollInfo + paginationMarker` can never itself
    // exceed TOOL_RESULT_MAX_CHARS, for ANY offset/max_chars combination.
    // Without this, the outer capToolResult choke point (below) would
    // silently overwrite this handler's own accurate, page-relative
    // continuation marker with its generic one — which reports the CAP as the
    // continuation offset instead of the true `windowEnd`, sending the model
    // backwards on every call past the first window. RESULT_OVERHEAD_RESERVE
    // is generous headroom for scrollInfo + paginationMarker (both well under
    // 300 chars in practice).
    const effectiveMaxChars = Math.min(maxChars, TOOL_RESULT_MAX_CHARS - RESULT_OVERHEAD_RESERVE);

    const content = await executeContentScript(tab.id!, () => {
      if (document.contentType?.includes('pdf') || location.protocol === 'chrome:') {
        return null;
      }
      return document.body?.innerText ?? '';
    });

    if (content === null) {
      throw Object.assign(new Error('Page has no extractable content (PDF, chrome:// page, or blank)'), { code: 'CONTENT_UNAVAILABLE' });
    }

    const full = format === 'html'
      ? await executeContentScript(tab.id!, () => document.body?.innerHTML ?? '')
      : content;

    const total = full.length;
    const windowed = full.slice(offset, offset + effectiveMaxChars);
    const windowEnd = offset + windowed.length;
    const remaining = Math.max(0, total - windowEnd);
    const paginationMarker = remaining > 0
      ? `\n\n[Showing chars ${offset}-${windowEnd} of ${total}. ${remaining} more chars available — call again with offset=${windowEnd}.]`
      : '';

    // AD-22: Append scroll state so AI knows there's content below the fold
    const scrollInfo = await executeContentScript(tab.id!, () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const viewportHeight = window.innerHeight;
      const viewBottom = scrollTop + viewportHeight;
      const pct = pageHeight <= viewportHeight ? 100 : Math.round((scrollTop / (pageHeight - viewportHeight)) * 100);
      const moreBelow = viewBottom < pageHeight - 1;
      return `\n\n--- Scroll Position ---\nViewing: ${Math.round(scrollTop)}-${Math.round(viewBottom)} of ${pageHeight}px (${pct}%)\nMore content below: ${moreBelow ? 'yes' : 'no'}`;
    });

    return { content: [{ type: 'text', text: windowed + scrollInfo + paginationMarker }] };
  },

  async take_screenshot(params) {
    const format = (params.format as string) ?? 'png';
    const quality = (params.quality as number) ?? 80;

    const tab = await getTab(params.tab_id as number | undefined);
    if (tab.url?.startsWith('chrome://')) {
      throw Object.assign(
        new Error(`Cannot screenshot chrome:// pages (${tab.url}). Navigate to a website first.`),
        { code: 'CONTENT_UNAVAILABLE' },
      );
    }

    // ROOT-CAUSE FIX: capture via CDP (Playwright `Page.captureScreenshot`),
    // NOT `chrome.tabs.captureVisibleTab`. captureVisibleTab only works when
    // the target WINDOW is focused/visible and HANGS forever — never resolving
    // OR rejecting — when it isn't (background window, occluded, or a heavy
    // still-painting tab). That was the actual cause of wedged screenshots
    // (confirmed via step logging: it never returned from captureVisibleTab).
    // CDP screenshots are taken from the renderer regardless of window focus,
    // so there's nothing to activate and nothing to hang on.
    try {
      return await withPlaywrightPage(tab.id!, async (page) => {
        // If the tab just navigated, the renderer hasn't painted the new page
        // yet and the capture blocks waiting for it. Bounded-wait for load
        // first (instant on an already-settled tab) so we screenshot a painted
        // page instead of racing the navigation.
        await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => { /* best-effort */ });
        // `animations: 'disabled'` + `caret: 'hide'` stop Playwright from
        // blocking on render/animation stability and a blinking caret before
        // capture — that wait is what made screenshots take up to ~13s on pages
        // with web fonts/animations (measured: attach ~0ms, the screenshot op
        // itself was the cost). `timeout` caps a genuinely stuck capture so it
        // fails fast with a clean error instead of hanging to the dispatch cap.
        const base = { animations: 'disabled' as const, caret: 'hide' as const, timeout: 12_000 };
        const raw = await page.screenshot(
          format === 'jpeg' ? { ...base, type: 'jpeg', quality } : { ...base, type: 'png' },
        );
        return {
          content: [{ type: 'image', data: bytesToBase64(new Uint8Array(raw)), mimeType: `image/${format}` }],
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(new Error(`Screenshot failed: ${message}`), { code: 'CONTENT_UNAVAILABLE' });
    }
  },

  async list_tabs(params) {
    const query = (params.query as string) ?? null;
    let tabs = await chrome.tabs.query({});

    if (query) {
      const q = query.toLowerCase();
      tabs = tabs.filter(t =>
        t.title?.toLowerCase().includes(q) || t.url?.toLowerCase().includes(q)
      );
    }

    // Namespace each tab id with this browser's instance id so the bridge
    // (which fans out list_tabs across N connected browsers) can route any
    // subsequent tool call back to the correct profile.
    const browserId = await getBrowserInstanceId();
    const result = tabs.map(t => ({
      id: t.id != null ? composeTabId(browserId, t.id) : null,
      title: t.title ?? '',
      url: t.url ?? '',
      active: t.active ?? false,
      pinned: t.pinned ?? false,
    }));

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  },

  async get_page_metadata(params) {
    const tab = await getTab(params.tab_id as number | undefined);

    const metadata = await executeContentScript(tab.id!, () => {
      const getMeta = (name: string) =>
        document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') ?? null;

      return {
        title: document.title,
        url: location.href,
        description: getMeta('description') ?? getMeta('og:description'),
        ogImage: getMeta('og:image'),
        ogTitle: getMeta('og:title'),
        favicon: (document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') as HTMLLinkElement)?.href ?? null,
      };
    });

    return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }] };
  },

  async navigate(params) {
    const url = params.url as string;

    // Check the DESTINATION url, not the current tab
    if (isBlockedDomain(url)) {
      throw Object.assign(new Error('That site is blocked for your protection'), { code: 'DOMAIN_BLOCKED' });
    }

    // Get the tab without blocklist check (we already checked the destination)
    const tab = await getTab(params.tab_id as number | undefined, false);
    const tabId = tab.id!;

    // Set up load listener BEFORE starting navigation to avoid missing the event
    const loaded = new Promise<chrome.tabs.Tab>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error('Page load timed out after 30s'), { code: 'CONTENT_UNAVAILABLE' }));
      }, 30_000);

      const onRemoved = (removedId: number) => {
        if (removedId === tabId) {
          cleanup();
          reject(Object.assign(new Error('Tab was closed during navigation'), { code: 'TAB_NOT_FOUND' }));
        }
      };

      const onUpdated = (updatedId: number, change: chrome.tabs.TabChangeInfo, updatedTab: chrome.tabs.Tab) => {
        if (updatedId === tabId && change.status === 'complete') {
          cleanup();
          resolve(updatedTab);
        }
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });

    // Start navigation after listener is in place
    await chrome.tabs.update(tabId, { url });

    const updated = await loaded;
    return withSnapshot(tabId, { content: [{ type: 'text', text: JSON.stringify({ success: true, url: updated.url, title: updated.title }) }] });
  },

  async fill_form(params) {
    const fields = params.fields as Array<{
      ref?: string;
      selector?: string;
      label?: string;
      role?: string;
      name?: string;
      placeholder?: string;
      value?: string;
      values?: string[];
      checked?: boolean;
      type?: string;
    }>;
    const iframeSelector = params.iframe as string | undefined;
    const tab = await getTab(params.tab_id as number | undefined);

    const results = await withPlaywrightPage(tab.id!, async (page) => {
      const fieldResults: Array<{ field: string; success: boolean; error?: string; errorCode?: string }> = [];

      for (const field of fields) {
        const fieldId = field.ref ? `ref=${field.ref}` :
          field.label || (field.role && field.name ? `${field.role}:${field.name}` : '') ||
          field.placeholder || field.selector || 'unknown';

        // Hoisted ABOVE the try so the catch can inspect them for stale-ref
        // classification/retry (corrected Fix B). Originally block-scoped inside
        // the try, which would leave them invisible to the catch.
        let locator: any;
        let detected: { tag: string; type: string; multiple: boolean; ce: boolean } = { tag: '', type: '', multiple: false, ce: false };
        let effectiveType = 'text';
        const valueStr = field.value ?? '';
        try {
          // Build locator with strict preference order: ref > label > role+name >
          // placeholder > selector. role-only is REJECTED — it silently filled the
          // first matching element on the page (a real bug, not a feature).
          if (field.ref) {
            // ref locators ignore the iframe parameter — refs are page-wide and
            // injected only in the top frame today (documented limitation).
            locator = page.locator(`[data-ai-ref="${field.ref}"]`);
          } else {
            const context = iframeSelector ? page.frameLocator(iframeSelector) : page;
            if (field.label) {
              locator = context.getByLabel(field.label);
            } else if (field.role) {
              if (!field.name) {
                fieldResults.push({
                  field: fieldId,
                  success: false,
                  error: 'role requires a `name` (e.g., {role: "textbox", name: "Email"}). Use ref from snapshot for unambiguous targeting.',
                });
                continue;
              }
              locator = context.getByRole(
                field.role as Parameters<typeof context.getByRole>[0],
                { name: field.name },
              );
            } else if (field.placeholder) {
              locator = context.getByPlaceholder(field.placeholder);
            } else if (field.selector) {
              locator = context.locator(field.selector);
            } else {
              fieldResults.push({ field: fieldId, success: false, error: 'No locator (ref, label, role+name, placeholder, or selector required)' });
              continue;
            }
          }

          // Auto-detect element type from the DOM. Only used when `field.type`
          // is not provided. This prevents the bug where omitting `type` for a
          // <select> caused locator.fill() to throw "element is not an input".
          if (!field.type) {
            try {
              detected = await locator.evaluate((el: Element) => ({
                tag: (el as HTMLElement).tagName,
                type: ((el as HTMLInputElement).type || '').toLowerCase(),
                multiple: !!(el as HTMLSelectElement).multiple,
                ce: (el as HTMLElement).isContentEditable,
              })) as { tag: string; type: string; multiple: boolean; ce: boolean };
            } catch {
              // Locator didn't resolve — let the action below throw a clearer error
            }
          }

          effectiveType =
            field.type ??
            (detected.tag === 'SELECT' ? 'select' :
             detected.type === 'checkbox' ? 'checkbox' :
             detected.type === 'radio' ? 'radio' :
             detected.type === 'file' ? 'file' :
             'text');

          // UNCHANGED action dispatch, extracted verbatim into performFieldAction
          // so the stale-ref retry can replay the SAME action against a freshly
          // re-resolved locator. Behavior is byte-identical to the inline switch.
          try {
            await performFieldAction(locator, effectiveType, detected, field, valueStr, fieldId, fieldResults);
          } catch (actionErr) {
            if (actionErr === FIELD_SKIPPED) continue; // a validation branch already pushed a result
            throw actionErr;
          }

          fieldResults.push({ field: fieldId, success: true });
        } catch (err) {
          // Classify WHY the field action failed (stale ref vs. found-but-blocked
          // vs. ambiguous) and, for a genuinely stale REF, attempt one bounded,
          // identity-verified retry. Validation errors never reach here — they
          // push their own result and `continue` via FIELD_SKIPPED above.
          let errorCode: string | undefined;
          if (locator) {
            const code = await classifyLocatorFailure(locator).catch(() => null);
            if (code) errorCode = code;
            if (code === 'REF_STALE' && field.ref) {
              const recovered = await attemptStaleRefRetryForField({
                page, tabId: tab.id!, ref: field.ref, effectiveType, detected, field, valueStr,
              }).catch(() => false);
              if (recovered) {
                fieldResults.push({ field: fieldId, success: true });
                continue;
              }
            }
          }
          fieldResults.push({
            field: fieldId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            ...(errorCode ? { errorCode } : {}),
          });
        }
      }

      return fieldResults;
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify(results) }] });
  },

  async click_element(params) {
    const ref = (params.ref as string | undefined) ?? null;
    const selector = (params.selector as string) ?? null;
    const text = (params.text as string) ?? null;
    const index = (params.index as number) ?? 0;
    const tab = await getTab(params.tab_id as number | undefined);

    const result = await withPlaywrightPage(tab.id!, async (page) => {
      let locator;
      if (ref) {
        locator = page.locator(`[data-ai-ref="${ref}"]`);
      } else if (text) {
        locator = page.getByText(text, { exact: false });
      } else if (selector) {
        locator = page.locator(selector);
      } else {
        throw new Error('Must provide ref, selector, or text');
      }

      if (index > 0) locator = locator.nth(index);

      // ROOT-CAUSE FIX: every locator op here is BOUNDED. The original bug was
      // an UNBOUNDED post-click `evaluateHandle` re-resolve that hung ~16-18s on
      // a detached/re-rendered element and reported a LANDED click as a failure.
      // Bounding everything — and never re-resolving after the click — makes a
      // click either succeed fast or fail fast & cleanly, with a fresh snapshot.
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { /* best-effort */ });

      // Element identity is nice-to-have, NOT essential — the fresh snapshot
      // below is the source of truth for what happened. Read it best-effort with
      // a hard 1.5s cap so a slow/ambiguous locator can never hang the tool.
      const element = await Promise.race([
        locator
          .evaluateHandle((el) => ({
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 100) ?? '',
            href: (el as HTMLAnchorElement).href ?? null,
          }))
          .then((h) => h.jsonValue())
          .catch(() => null),
        new Promise<null>((res) => setTimeout(() => res(null), 1500)),
      ]);

      // Case-4 (silent wrong-click) detection: compare the just-resolved element
      // against the fingerprint recorded when this `ref` was minted by the last
      // snapshot, and ANNOTATE — never block — a mismatch. This reuses the
      // best-effort probe above, so it adds no latency and never gates the click.
      let refIdentityWarning: string | undefined;
      if (ref && element) {
        const expected = refFingerprintCache.get(tab.id!)?.get(ref);
        if (expected && !fingerprintsRoughlyMatch(expected, element as { text?: string })) {
          refIdentityWarning =
            `ref ${ref} resolved to an element whose identity looks different from the ` +
            `last snapshot (expected ${expected.role} "${expected.name}"); clicked it anyway — ` +
            `re-snapshot to confirm this was the intended target.`;
        }
      }

      // Bounded click — UNCHANGED from today: same call, same 8s budget, same
      // auto-wait semantics. A click that would succeed today succeeds
      // identically here — nothing runs before it and nothing shortens it.
      // NEW: only if it throws do we classify WHY (stale ref vs. found-but-
      // blocked vs. ambiguous) and, for a genuinely stale ref, attempt one
      // bounded, identity-verified retry. See classifyAndMaybeRetryClick.
      try {
        await locator.click({ timeout: 8_000 });
      } catch (clickErr) {
        await classifyAndMaybeRetryClick({ page, tabId: tab.id!, locator, ref, originalError: clickErr });
        // Reaching here (no throw) means the bounded retry recovered — treat
        // exactly like a normal successful click.
      }

      return { ...((element as object | null) ?? {}), refIdentityWarning };
    });

    // Always return a FRESH snapshot (best-effort) so the caller gets current
    // refs even after a navigation/re-render — no separate re-snapshot round
    // trip. Refs are render-scoped; this is the contract that makes them usable.
    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify({ success: true, element: result }) }] });
  },

  async press_key(params) {
    const ref = (params.ref as string | undefined) ?? null;
    const selector = (params.selector as string | undefined) ?? null;
    const key = params.key as string;
    if (!key) throw new Error('press_key requires `key` (e.g., "Enter", "Escape", "Tab")');
    const tab = await getTab(params.tab_id as number | undefined);

    await withPlaywrightPage(tab.id!, async (page) => {
      // Bounded + noWaitAfter, same as click_element: a key like Enter submits
      // and navigates; without these a press on a slow/navigating target hangs
      // up to the default 30s (only the 25s dispatch cap would catch it).
      const pressOpts = { timeout: 8_000, noWaitAfter: true };
      if (ref) {
        const locator = page.locator(`[data-ai-ref="${ref}"]`);
        // UNCHANGED action, unchanged budget. Classification runs only in the catch.
        try {
          await locator.press(key, pressOpts);
        } catch (pressErr) {
          await classifyAndMaybeRetryPress({ page, tabId: tab.id!, locator, ref, key, pressOpts, originalError: pressErr });
        }
      } else if (selector) {
        const locator = page.locator(selector);
        try {
          await locator.press(key, pressOpts);
        } catch (pressErr) {
          // No ref to retry against — classify and surface, same as
          // click_element's selector/text branch.
          const code = await classifyLocatorFailure(locator);
          if (code === null) throw pressErr;
          throw toClassifiedError(code, pressErr);
        }
      } else {
        // No target — fire as a global keyboard event on the page. Nothing to
        // classify; this path has no locator and can't go stale.
        await page.keyboard.press(key);
      }
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify({ success: true, key }) }] });
  },

  async extract_table(params) {
    const selector = (params.selector as string) ?? null;
    const index = (params.index as number) ?? 0;
    const tab = await getTab(params.tab_id as number | undefined);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (sel: string | null, idx: number) => {
        const tables = sel
          ? [document.querySelector(sel) as HTMLTableElement]
          : Array.from(document.querySelectorAll('table'));

        const table = tables[idx];
        if (!table) return null;

        const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent?.trim() ?? '');
        const rows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(headers.length ? 0 : 1).map(tr =>
          Array.from(tr.querySelectorAll('td, th')).map(td => td.textContent?.trim() ?? '')
        );

        return { headers, rows };
      },
      args: [selector, index],
    });

    const tableData = result?.[0]?.result;
    if (!tableData) throw Object.assign(new Error('No table found on page'), { code: 'CONTENT_UNAVAILABLE' });
    return { content: [{ type: 'text', text: JSON.stringify(tableData, null, 2) }] };
  },

  async read_form(params) {
    const selector = params.selector as string | undefined;
    const tab = await getTab(params.tab_id as number | undefined);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: readFormFields,
      args: [selector],
    });

    const formData = result?.[0]?.result;
    if (!formData || (formData.forms.length === 0)) {
      throw Object.assign(new Error('No form fields found on page'), { code: 'CONTENT_UNAVAILABLE' });
    }

    return { content: [{ type: 'text', text: JSON.stringify(formData, null, 2) }] };
  },

  async scroll_page(params) {
    const tab = await getTab(params.tab_id as number | undefined);
    const direction = (params.direction as string) ?? null;
    const amount = (params.amount as number) ?? null;
    const selector = (params.selector as string) ?? null;
    const text = (params.text as string) ?? null;
    const waitForContent = (params.wait_for_content as boolean) ?? true;

    const result = await withPlaywrightPage(tab.id!, async (page) => {
      // Get page height before scroll
      const beforeHeight = await page.evaluate(() =>
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      );

      let scrollError: string | null = null;

      // Priority: selector > text > direction > default (scroll down)
      if (selector) {
        const el = page.locator(selector).first();
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch {
          scrollError = 'Selector not found: ' + selector;
        }
      } else if (text) {
        const el = page.getByText(text, { exact: false }).first();
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch {
          scrollError = 'Text not found on page: ' + text;
        }
      } else {
        // Direction-based scroll — mouse.wheel at viewport center handles
        // both window scroll and virtualized containers (Threads, Twitter, etc.)
        const vh = await page.evaluate(() => window.innerHeight);
        const delta = amount ?? vh;
        const centerX = await page.evaluate(() => window.innerWidth / 2);
        const centerY = vh / 2;

        // Move mouse to center so wheel targets the right scroll container
        await page.mouse.move(centerX, centerY);

        switch (direction) {
          case 'up':
            await page.mouse.wheel(0, -delta);
            break;
          case 'top':
            await page.evaluate(() => window.scrollTo(0, 0));
            // Also try scrolling any container to top
            await page.evaluate(() => {
              const all = document.querySelectorAll('*');
              for (const el of all) {
                const s = window.getComputedStyle(el);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
                  el.scrollTop = 0;
                }
              }
            });
            break;
          case 'bottom':
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await page.evaluate(() => {
              const all = document.querySelectorAll('*');
              for (const el of all) {
                const s = window.getComputedStyle(el);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
                  el.scrollTop = el.scrollHeight;
                }
              }
            });
            break;
          default: // 'down' or unspecified
            await page.mouse.wheel(0, delta);
            break;
        }
      }

      // Wait for content to settle
      if (waitForContent) {
        // Wait for network idle briefly, then DOM stability
        await page.waitForTimeout(800);
      }

      // Read final state
      const state = await page.evaluate((prevHeight: number) => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        const viewportHeight = window.innerHeight;
        const pct = pageHeight <= viewportHeight ? 100
          : Math.round((scrollTop / (pageHeight - viewportHeight)) * 100);

        // Visible text
        const parts: string[] = [];
        let totalLen = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent) continue;
          const rect = parent.getBoundingClientRect();
          if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
            const t = (node.textContent ?? '').trim();
            if (t) { parts.push(t); totalLen += t.length; if (totalLen >= 2000) break; }
          }
        }

        return {
          scrolledTo: { x: window.pageXOffset || 0, y: Math.round(scrollTop) },
          pageHeight,
          viewportHeight,
          scrollPercentage: Math.min(100, Math.max(0, pct)),
          isAtBottom: Math.ceil(scrollTop + viewportHeight) >= pageHeight - 2,
          isAtTop: scrollTop <= 1,
          contentChanged: pageHeight > prevHeight,
          visibleText: parts.join(' ').slice(0, 2000),
        };
      }, beforeHeight);

      return scrollError ? { ...state, found: false, error: scrollError } : state;
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  },

  async go_back(params) {
    const tab = await getTab(params.tab_id as number | undefined, false);
    const waitUntil = (params.wait_until as string) ?? 'domcontentloaded';

    const result = await withPlaywrightPage(tab.id!, async (page) => {
      await page.goBack({ waitUntil: waitUntil as 'load' | 'domcontentloaded' });
      return { success: true, url: page.url(), title: await page.title() };
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  },

  async go_forward(params) {
    const tab = await getTab(params.tab_id as number | undefined, false);
    const waitUntil = (params.wait_until as string) ?? 'domcontentloaded';

    const result = await withPlaywrightPage(tab.id!, async (page) => {
      await page.goForward({ waitUntil: waitUntil as 'load' | 'domcontentloaded' });
      return { success: true, url: page.url(), title: await page.title() };
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify(result) }] });
  },

  async extract_data(params) {
    const options = {
      selector: params.selector as string | undefined,
      columns: params.columns as string[] | undefined,
      maxRows: (params.max_rows as number) ?? 100,
      includeLinks: (params.include_links as boolean) ?? false,
    };
    const format = (params.format as string) ?? 'table';
    const tab = await getTab(params.tab_id as number | undefined);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: detectAndExtractData,
      args: [options],
    });

    const extractResult = result?.[0]?.result;
    if (!extractResult?.bestRegion) {
      throw Object.assign(
        new Error(
          'No structured data detected: no HTML tables and no consistent repeating card/list ' +
          'pattern found on this page. Try `snapshot` for an accessibility-tree view, or ' +
          '`get_page_content` (with offset for pagination) to read the raw text.',
        ),
        { code: 'CONTENT_UNAVAILABLE' },
      );
    }

    // Format output based on requested format
    if (format === 'json') {
      // Convert rows to array of objects using headers as keys
      const region = extractResult.bestRegion;
      const data = region.rows.map((row: string[]) => {
        const obj: Record<string, string> = {};
        region.headers.forEach((header: string, i: number) => {
          obj[header || `field_${i}`] = row[i] ?? '';
        });
        return obj;
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            data,
            total_detected: region.totalDetected,
            source: region.source,
            pagination_detected: region.paginationDetected,
            next_button_selector: region.nextButtonSelector,
          }, null, 2),
        }],
      };
    }

    // Table format (default)
    const region = extractResult.bestRegion;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          headers: region.headers,
          rows: region.rows,
          total_detected: region.totalDetected,
          source: region.source,
          pagination_detected: region.paginationDetected,
          next_button_selector: region.nextButtonSelector,
        }, null, 2),
      }],
    };
  },

  async snapshot(params) {
    const tab = await getTab(params.tab_id as number | undefined);
    const snap = await captureSnapshot(tab.id!);
    if (!snap) {
      throw Object.assign(new Error('Could not capture page snapshot'), { code: 'CONTENT_UNAVAILABLE' });
    }
    const url = tab.url ?? '';
    const title = tab.title ?? '';
    return {
      content: [{
        type: 'text',
        text: `- Page URL: ${url}\n- Page Title: ${title}\n- Page Snapshot\n\`\`\`yaml\n${snap}\n\`\`\``,
      }],
    };
  },
};

// Hard ceiling for any single tool. Kept under the bridge's tool_request
// timeout (30s) so the extension reports a clear, tool-specific error FIRST
// instead of the bridge giving up with a generic timeout while this promise
// leaks forever. Chrome/Playwright calls (e.g. captureVisibleTab on a wedged
// or still-loading page) can hang indefinitely with no rejection — without
// this race, dispatchTool never settles and `ext.tool.dispatch.complete` is
// never logged.
export const TOOL_DISPATCH_TIMEOUT_MS = 25_000;

// Hard ceiling for any single `content[].text` field any tool handler returns.
// Same choke-point pattern as TOOL_DISPATCH_TIMEOUT_MS (root guard, close to
// where the unbounded string is actually created) — this is the SIZE analogue
// of that TIME guard. Root incident: a Threads (infinite-scroll) page accumulated
// hundreds of KB after repeated scroll_page calls; get_page_content returned it
// verbatim (403,154 chars in one tool result), which alone exceeded the MCP
// client's 200k-TOKEN context budget and killed the session. `snapshot`
// (accessibility-tree dump) has the identical unbounded-on-accumulated-DOM shape
// and is capped by the same mechanism even though it hasn't caused an incident yet.
// 80,000 chars ≈ 20k tokens at ~4 chars/token — generous for a single tool result
// while leaving the model most of a 200k-token budget for everything else.
// A matching backstop lives in packages/native-host/src/service.ts
// (`TOOL_RESULT_MAX_CHARS`) — that copy MUST be kept in sync manually, since the
// extension and native-host packages don't share a build.
export const TOOL_RESULT_MAX_CHARS = 80_000;

// Headroom reserved when a handler (currently only get_page_content) builds
// its own bounded, page-relative output ahead of the capToolResult choke
// point below. get_page_content clamps its window to
// `TOOL_RESULT_MAX_CHARS - RESULT_OVERHEAD_RESERVE` so that its own
// windowed text plus scrollInfo plus its accurate pagination marker can
// never exceed TOOL_RESULT_MAX_CHARS — i.e. capToolResult should never need
// to touch a well-formed get_page_content response. 1000 chars is generous:
// scrollInfo and the pagination marker are both well under 300 chars in
// practice, even with very large page-size numbers.
const RESULT_OVERHEAD_RESERVE = 1000;

/** Truncate a single text field to `cap` chars, appending an explicit,
 * actionable marker — never a silent cut. A payload at or under `cap` passes
 * through byte-identical (no marker, no mutation); this is load-bearing for
 * callers that diff/hash tool output. Exactly-at-cap is defined as NOT
 * truncated (`<=`, not `<`) — kept consistent with the bridge-side backstop
 * in service.ts so the two choke points never disagree at the boundary.
 *
 * The marker is deliberately tool-agnostic — it fires for EVERY tool's
 * oversized output (snapshot, extract_data, etc.), not just
 * get_page_content, so it must not claim an `offset` param those tools
 * don't have. get_page_content's own handler builds its own accurate,
 * page-relative "call again with offset=N" marker BEFORE this generic one
 * ever runs (see RESULT_OVERHEAD_RESERVE) — this text is the fallback for
 * every other tool, and for the rare case get_page_content's own output
 * still needs trimming.
 *
 * KEEP THIS STRING IDENTICAL to `truncateText` in
 * packages/native-host/src/service.ts — that copy MUST be kept in sync
 * manually, since the extension and native-host packages don't share a
 * build. */
function truncateText(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return (
    text.slice(0, cap) +
    `\n\n[TRUNCATED: content was ${text.length} chars, showing first ${cap}. ` +
    `If this tool supports pagination (e.g. get_page_content's offset param), ` +
    `use it to continue; otherwise narrow your request (e.g. a selector).]`
  );
}

/** Walk whatever a tool handler returned and cap every `content[].text`
 * field. This is the SINGLE choke point for the size invariant — individual
 * handlers must never truncate their own output; they just return whatever
 * they naturally produce and this catches it uniformly (mirrors how
 * `withTimeout` is the single choke point for the time invariant). Non-object
 * results, or results without a `content` array (defensive — every handler
 * in `tools` currently returns `{ content: [...] }`), pass through untouched.
 * Exported for tests. */
export function capToolResult(result: unknown, cap: number = TOOL_RESULT_MAX_CHARS): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as { content?: unknown };
  if (!Array.isArray(r.content)) return result;

  return {
    ...r,
    content: r.content.map((item: unknown) => {
      if (
        item && typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
      ) {
        return { ...(item as object), text: truncateText((item as { text: string }).text, cap) };
      }
      return item;
    }),
  };
}

/**
 * Race a promise against a timeout. If `p` doesn't settle within `ms`, reject
 * with a TOOL_TIMEOUT error. The underlying Chrome/Playwright call cannot be
 * cancelled, so it keeps running and its eventual result is ignored — the
 * point is that the CALLER always settles instead of hanging forever.
 * Exported for tests.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(
        new Error(`Tool '${label}' timed out after ${ms}ms — the page may be unresponsive (still loading or a heavy SPA). Reload the tab and try again.`),
        { code: 'TOOL_TIMEOUT' },
      ));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export const dispatchTool = async (
  toolName: string,
  params: Record<string, unknown>,
  timeoutMs: number = TOOL_DISPATCH_TIMEOUT_MS,
): Promise<unknown> => {
  const handler = tools[toolName];
  if (!handler) {
    void logRecord({
      event: 'ext.tool.dispatch.unknown',
      lvl: 'warn',
      toolName,
      params,
    });
    throw Object.assign(new Error(`Unknown tool: ${toolName}`), { code: 'CONTENT_UNAVAILABLE' });
  }

  const startTime = Date.now();
  const tab = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const targetUrl = tab[0]?.url ?? null;

  const entry: ActivityEntry = {
    id: crypto.randomUUID(),
    timestamp: startTime,
    tool: toolName,
    targetUrl,
    status: 'in-progress',
    duration: null,
    errorCode: null,
  };

  await logActivity(entry);
  void logRecord({
    event: 'ext.tool.dispatch.start',
    toolName,
    activityId: entry.id,
    targetUrl: targetUrl ?? undefined,
    params,
  });

  try {
    const rawResult = await withTimeout(handler(params), timeoutMs, toolName);
    // Size choke point (see TOOL_RESULT_MAX_CHARS doc comment): applied uniformly
    // to EVERY handler's output here, not copy-pasted into each handler.
    const result = capToolResult(rawResult);
    entry.status = 'success';
    entry.duration = Date.now() - startTime;
    await logActivity(entry);
    void logRecord({
      event: 'ext.tool.dispatch.complete',
      toolName,
      activityId: entry.id,
      durationMs: entry.duration,
    });
    return result;
  } catch (error: unknown) {
    entry.status = 'error';
    entry.duration = Date.now() - startTime;
    entry.errorCode = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
    await logActivity(entry);
    void logError('ext.tool.dispatch.error', error, {
      toolName,
      activityId: entry.id,
      durationMs: entry.duration,
    });
    throw error;
  }
};
