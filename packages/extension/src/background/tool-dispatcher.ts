import type { ActivityEntry } from '../shared/types.js';
import { MAX_ACTIVITY_LOG_SIZE } from '../shared/constants.js';
import { isBlockedDomain } from '../shared/domain-blocklist.js';
import { withPlaywrightPage } from './playwright-bridge.js';
import { readFormFields } from '../content/form-reader.js';
import { detectAndExtractData } from '../content/data-detector.js';

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

const getTab = async (tabId?: number, checkBlocked = true): Promise<chrome.tabs.Tab> => {
  let tab: chrome.tabs.Tab;

  if (tabId) {
    tab = await chrome.tabs.get(tabId);
    // Auto-activate the targeted tab so the user sees what we're working on
    await chrome.tabs.update(tab.id!, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw Object.assign(new Error('No active tab found'), { code: 'TAB_NOT_FOUND' });
    tab = activeTab;
  }

  if (checkBlocked && tab.url && isBlockedDomain(tab.url)) {
    throw Object.assign(new Error('That site is blocked for your protection'), { code: 'DOMAIN_BLOCKED' });
  }
  return tab;
};

const executeContentScript = async <T>(tabId: number, func: () => T): Promise<T> => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
  });
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

    return { content: [{ type: 'text', text: result }] };
  },

  async take_screenshot(params) {
    const format = (params.format as string) ?? 'png';
    const quality = (params.quality as number) ?? 80;

    // If tab_id provided, activate it first (captureVisibleTab captures the active tab)
    const tab = await getTab(params.tab_id as number | undefined);
    if (tab.url?.startsWith('chrome://')) {
      throw Object.assign(
        new Error(`Cannot screenshot chrome:// pages (${tab.url}). Navigate to a website first.`),
        { code: 'CONTENT_UNAVAILABLE' },
      );
    }

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

    const result = tabs.map(t => ({
      id: t.id,
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
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, url: updated.url, title: updated.title }) }] };
  },

  async fill_form(params) {
    const fields = params.fields as Array<{
      selector?: string;
      label?: string;
      role?: string;
      placeholder?: string;
      value: string;
      type?: string;
    }>;
    const iframeSelector = params.iframe as string | undefined;
    const tab = await getTab(params.tab_id as number | undefined);

    // Determine if we need playwright-crx (complex operations) or can use simple approach
    const needsPlaywright = fields.some(f =>
      f.label || f.role || f.placeholder ||
      f.type === 'select' || f.type === 'checkbox' || f.type === 'radio' ||
      f.type === 'file' || f.type === 'date',
    ) || !!iframeSelector;

    if (needsPlaywright) {
      // Use playwright-crx for complex form interactions
      const results = await withPlaywrightPage(tab.id!, async (page) => {
        const fieldResults: Array<{ field: string; success: boolean; error?: string }> = [];

        for (const field of fields) {
          try {
            // Determine the base context (page or iframe)
            const context = iframeSelector
              ? page.frameLocator(iframeSelector)
              : page;

            // Determine locator
            let locator;
            if (field.label) {
              locator = context.getByLabel(field.label);
            } else if (field.role) {
              locator = context.getByRole(field.role as Parameters<typeof context.getByRole>[0]);
            } else if (field.placeholder) {
              locator = context.getByPlaceholder(field.placeholder);
            } else if (field.selector) {
              locator = context.locator(field.selector);
            } else {
              fieldResults.push({ field: JSON.stringify(field), success: false, error: 'No locator provided (need selector, label, role, or placeholder)' });
              continue;
            }

            const fieldId = field.label || field.role || field.placeholder || field.selector || 'unknown';

            // Perform the appropriate action based on type
            switch (field.type) {
              case 'select':
                await locator.selectOption(field.value);
                break;
              case 'checkbox':
                if (field.value === 'true' || field.value === 'on') {
                  await locator.check();
                } else {
                  await locator.uncheck();
                }
                break;
              case 'radio':
                await locator.check();
                break;
              case 'file':
                await locator.setInputFiles(field.value);
                break;
              case 'date':
                await locator.fill(field.value);
                break;
              default:
                await locator.fill(field.value);
                break;
            }

            fieldResults.push({ field: fieldId, success: true });
          } catch (err) {
            const fieldId = field.label || field.role || field.placeholder || field.selector || 'unknown';
            fieldResults.push({
              field: fieldId,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return fieldResults;
      });

      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }

    // Simple path: use chrome.scripting for basic text fills (no debugger needed)
    // Uses native value setter to work with React/Vue controlled inputs
    const simpleFields = fields.map(f => ({ selector: f.selector!, value: f.value }));
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (fieldList: Array<{ selector: string; value: string }>) => {
        // Shadow DOM traversal fallback
        function queryShadow(selector: string): Element | null {
          let el = document.querySelector(selector);
          if (el) return el;
          const hosts = document.querySelectorAll('*');
          for (const host of hosts) {
            if (host.shadowRoot) {
              el = host.shadowRoot.querySelector(selector);
              if (el) return el;
            }
          }
          return null;
        }

        // Get native setters — React/Vue override .value, so direct assignment doesn't trigger state updates
        const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

        return fieldList.map(({ selector, value }) => {
          const el = queryShadow(selector) as HTMLElement | null;
          if (!el) return { selector, success: false, error: 'Element not found' };

          try {
            // Gap 4: Contenteditable support — must trigger mutation observers and editor listeners
            if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
              el.focus();
              // Select all existing content and replace it
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              selection?.removeAllRanges();
              selection?.addRange(range);
              // execCommand triggers mutation observers, input events, and editor state sync
              document.execCommand('insertText', false, value);
              // Fire events for any listeners that execCommand didn't trigger
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { selector, success: true };
            }

            // Gap 3: ARIA widget interaction (div-based, not native inputs)
            const role = el.getAttribute('role');
            if (role === 'slider') {
              el.setAttribute('aria-valuenow', value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return { selector, success: true };
            } else if (role === 'switch') {
              const checked = value === 'true' || value === 'on';
              el.setAttribute('aria-checked', String(checked));
              el.click();
              return { selector, success: true };
            } else if (role === 'combobox' || role === 'listbox') {
              const hiddenInput = el.querySelector('input[type="hidden"]') || el.parentElement?.querySelector('input[type="hidden"]');
              if (hiddenInput) (hiddenInput as HTMLInputElement).value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { selector, success: true };
            }

            // Standard input/textarea/select path
            const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

            // Use the native setter for the right element type
            if (inputEl instanceof HTMLTextAreaElement && textareaSetter) {
              textareaSetter.call(inputEl, value);
            } else if (inputEl instanceof HTMLSelectElement && selectSetter) {
              selectSetter.call(inputEl, value);
            } else if (inputSetter) {
              inputSetter.call(inputEl, value);
            } else {
              inputEl.value = value;
            }

            // Fire events that React/Vue/Angular listen to
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // React 17+ also listens for native input events
            el.dispatchEvent(new Event('blur', { bubbles: true }));

            // Gap 1: Fire keyboard events for autocomplete/typeahead triggers
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
            el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }));

            return { selector, success: true };
          } catch (err) {
            return { selector, success: false, error: (err as Error).message };
          }
        });
      },
      args: [simpleFields],
    });

    return { content: [{ type: 'text', text: JSON.stringify(results?.[0]?.result ?? []) }] };
  },

  async click_element(params) {
    const selector = (params.selector as string) ?? null;
    const text = (params.text as string) ?? null;
    const index = (params.index as number) ?? 0;
    const tab = await getTab(params.tab_id as number | undefined);

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (sel: string | null, txt: string | null, idx: number) => {
        // By CSS selector — return the nth match
        if (sel) {
          const matches = Array.from(document.querySelectorAll(sel));
          const el = matches[idx];
          if (!el) return null;
          (el as HTMLElement).click();
          return {
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 100),
            href: (el as HTMLAnchorElement).href ?? null,
            matchCount: matches.length,
            matchIndex: idx,
          };
        }

        // By visible text — prefer clickable elements, match direct text not inherited
        if (txt) {
          const clickable = 'a, button, input[type="submit"], input[type="button"], [role="button"], [onclick], summary';
          const target = txt.toLowerCase();

          // Pass 1: exact match on clickable elements (direct text only)
          const clickables = Array.from(document.querySelectorAll(clickable));
          const exactClickable = clickables.filter(el => {
            // Get direct text (not from children) or the full text for simple elements
            const elText = el.textContent?.trim().toLowerCase() ?? '';
            return elText === target;
          });
          if (exactClickable.length > idx) {
            const el = exactClickable[idx] as HTMLElement;
            el.click();
            return {
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 100),
              href: (el as HTMLAnchorElement).href ?? null,
              matchCount: exactClickable.length,
              matchIndex: idx,
            };
          }

          // Pass 2: partial/contains match on clickable elements
          const partialClickable = clickables.filter(el => {
            const elText = el.textContent?.trim().toLowerCase() ?? '';
            return elText.includes(target);
          });
          if (partialClickable.length > idx) {
            const el = partialClickable[idx] as HTMLElement;
            el.click();
            return {
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 100),
              href: (el as HTMLAnchorElement).href ?? null,
              matchCount: partialClickable.length,
              matchIndex: idx,
            };
          }

          // Pass 3: any element with exact text (fallback)
          const allElements = Array.from(document.querySelectorAll('*'));
          const anyMatch = allElements.filter(el => {
            const elText = el.textContent?.trim().toLowerCase() ?? '';
            return elText === target && el.children.length === 0; // leaf nodes only
          });
          if (anyMatch.length > idx) {
            const el = anyMatch[idx] as HTMLElement;
            el.click();
            return {
              tag: el.tagName,
              text: el.textContent?.trim().slice(0, 100),
              href: (el as HTMLAnchorElement).href ?? null,
              matchCount: anyMatch.length,
              matchIndex: idx,
            };
          }
        }

        return null;
      },
      args: [selector, text, index],
    });

    const clicked = result?.[0]?.result;
    if (!clicked) throw Object.assign(new Error('Element not found'), { code: 'CONTENT_UNAVAILABLE' });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, element: clicked }) }] };
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
