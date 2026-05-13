import type { ActivityEntry } from '../shared/types.js';
import { MAX_ACTIVITY_LOG_SIZE } from '../shared/constants.js';
import { isBlockedDomain } from '../shared/domain-blocklist.js';
import { withPlaywrightPage } from './playwright-bridge.js';
import type { Page } from 'playwright-crx/test';
import { readFormFields } from '../content/form-reader.js';
import { detectAndExtractData } from '../content/data-detector.js';
import { getBrowserInstanceId } from '../shared/browser-instance-id.js';
import { composeTabId, parseTabId } from '../shared/tab-id.js';

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

const captureSnapshot = async (tabId: number): Promise<string> => {
  try {
    return await withPlaywrightPage(tabId, async (page: Page) => {
      const refLines = await page.evaluate(SNAPSHOT_REF_INJECTOR).catch(() => '') as string;
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
  if (!snapshot) return result;
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

    const content = await executeContentScript(tab.id!, () => {
      if (document.contentType?.includes('pdf') || location.protocol === 'chrome:') {
        return null;
      }
      return document.body?.innerText ?? '';
    });

    if (content === null) {
      throw Object.assign(new Error('Page has no extractable content (PDF, chrome:// page, or blank)'), { code: 'CONTENT_UNAVAILABLE' });
    }

    const result = format === 'html'
      ? await executeContentScript(tab.id!, () => document.body?.innerHTML ?? '')
      : content;

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

    return { content: [{ type: 'text', text: result + scrollInfo }] };
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

    // captureVisibleTab only captures the active tab in the window, so we
    // must activate the target. This is the only tool that needs to.
    await chrome.tabs.update(tab.id!, { active: true });

    // Use the tab's window ID (more reliable than getCurrent() in service workers)
    const windowId = tab.windowId ?? (await chrome.windows.getCurrent()).id;

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: format as 'png' | 'jpeg',
        quality,
      });

      const base64 = dataUrl.split(',')[1] ?? dataUrl;
      return { content: [{ type: 'image', data: base64, mimeType: `image/${format}` }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Provide helpful error messages for common failures
      if (message.includes('activeTab') || message.includes('permission')) {
        throw Object.assign(
          new Error('Cannot capture this page. Try clicking on the page first, or navigate to a different site.'),
          { code: 'CONTENT_UNAVAILABLE' },
        );
      }
      if (message.includes('readback') || message.includes('capture')) {
        throw Object.assign(
          new Error('Screenshot failed — make sure the browser window is visible (not minimized).'),
          { code: 'CONTENT_UNAVAILABLE' },
        );
      }
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
      const fieldResults: Array<{ field: string; success: boolean; error?: string }> = [];

      for (const field of fields) {
        const fieldId = field.ref ? `ref=${field.ref}` :
          field.label || (field.role && field.name ? `${field.role}:${field.name}` : '') ||
          field.placeholder || field.selector || 'unknown';

        try {
          // Build locator with strict preference order: ref > label > role+name >
          // placeholder > selector. role-only is REJECTED — it silently filled the
          // first matching element on the page (a real bug, not a feature).
          let locator;
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
          let detected: { tag: string; type: string; multiple: boolean; ce: boolean } = { tag: '', type: '', multiple: false, ce: false };
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

          const effectiveType =
            field.type ??
            (detected.tag === 'SELECT' ? 'select' :
             detected.type === 'checkbox' ? 'checkbox' :
             detected.type === 'radio' ? 'radio' :
             detected.type === 'file' ? 'file' :
             'text');

          const valueStr = field.value ?? '';

          switch (effectiveType) {
            case 'select': {
              const opts = field.values ?? (valueStr ? [valueStr] : []);
              if (opts.length === 0) {
                fieldResults.push({ field: fieldId, success: false, error: 'select requires `value` or `values`' });
                continue;
              }
              await locator.selectOption(detected.multiple ? opts : opts[0]);
              break;
            }
            case 'checkbox': {
              // Prefer explicit `checked`. Fallback: parse common truthy strings.
              const truthy = field.checked ?? /^(true|on|yes|1|checked)$/i.test(valueStr);
              if (truthy) await locator.check();
              else await locator.uncheck();
              break;
            }
            case 'radio': {
              // Radios cannot be unchecked individually. `checked: false` is a
              // user error — radios are selected by checking a different one.
              if (field.checked === false) {
                fieldResults.push({ field: fieldId, success: false, error: 'radio cannot be unchecked; check a sibling radio instead' });
                continue;
              }
              await locator.check();
              break;
            }
            case 'file':
              await locator.setInputFiles(field.values ?? valueStr);
              break;
            default:
              await locator.fill(valueStr);
              break;
          }

          fieldResults.push({ field: fieldId, success: true });
        } catch (err) {
          fieldResults.push({
            field: fieldId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
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

      await locator.scrollIntoViewIfNeeded();
      await locator.click();

      const el = await locator.evaluateHandle((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 100) ?? '',
        href: (el as HTMLAnchorElement).href ?? null,
      }));

      return await el.jsonValue();
    });

    return withSnapshot(tab.id!, { content: [{ type: 'text', text: JSON.stringify({ success: true, element: result }) }] });
  },

  async press_key(params) {
    const ref = (params.ref as string | undefined) ?? null;
    const selector = (params.selector as string | undefined) ?? null;
    const key = params.key as string;
    if (!key) throw new Error('press_key requires `key` (e.g., "Enter", "Escape", "Tab")');
    const tab = await getTab(params.tab_id as number | undefined);

    await withPlaywrightPage(tab.id!, async (page) => {
      if (ref) {
        await page.locator(`[data-ai-ref="${ref}"]`).press(key);
      } else if (selector) {
        await page.locator(selector).press(key);
      } else {
        // No target — fire as a global keyboard event on the page.
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
      throw Object.assign(new Error('No structured data detected on page'), { code: 'CONTENT_UNAVAILABLE' });
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

export const dispatchTool = async (toolName: string, params: Record<string, unknown>): Promise<unknown> => {
  const handler = tools[toolName];
  if (!handler) {
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

  try {
    const result = await handler(params);
    entry.status = 'success';
    entry.duration = Date.now() - startTime;
    await logActivity(entry);
    return result;
  } catch (error: unknown) {
    entry.status = 'error';
    entry.duration = Date.now() - startTime;
    entry.errorCode = (error as { code?: string })?.code ?? 'CONTENT_UNAVAILABLE';
    await logActivity(entry);
    throw error;
  }
};
