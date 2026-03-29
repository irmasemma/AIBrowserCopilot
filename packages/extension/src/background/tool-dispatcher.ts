import type { ActivityEntry } from '../shared/types.js';
import { MAX_ACTIVITY_LOG_SIZE } from '../shared/constants.js';
import { isBlockedDomain } from '../shared/domain-blocklist.js';

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

const getActiveTab = async (checkBlocked = true): Promise<chrome.tabs.Tab> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw Object.assign(new Error('No active tab found'), { code: 'TAB_NOT_FOUND' });
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
    const tab = await getActiveTab();
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

    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: format as 'png' | 'jpeg',
      quality,
    });

    const base64 = dataUrl.split(',')[1] ?? dataUrl;
    return { content: [{ type: 'image', data: base64, mimeType: `image/${format}` }] };
  },

  async list_tabs(params) {
    const query = params.query as string | undefined;
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

  async get_page_metadata() {
    const tab = await getActiveTab();

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
    const tabId = params.tab_id as number | undefined;

    const tab = tabId
      ? await chrome.tabs.get(tabId)
      : await getActiveTab();

    const updated = await chrome.tabs.update(tab.id!, { url });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, url: updated.url, title: updated.title }) }] };
  },

  async fill_form(params) {
    const fields = params.fields as Array<{ selector: string; value: string }>;
    const tab = await getActiveTab();

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (fieldList: Array<{ selector: string; value: string }>) => {
        return fieldList.map(({ selector, value }) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el) return { selector, success: false, error: 'Element not found' };
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { selector, success: true };
        });
      },
      args: [fields],
    });

    return { content: [{ type: 'text', text: JSON.stringify(results?.[0]?.result ?? []) }] };
  },

  async click_element(params) {
    const selector = params.selector as string | undefined;
    const text = params.text as string | undefined;
    const tab = await getActiveTab();

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (sel: string | undefined, txt: string | undefined) => {
        let el: Element | null = null;
        if (sel) {
          el = document.querySelector(sel);
        } else if (txt) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            const node = walker.currentNode as HTMLElement;
            if (node.textContent?.trim() === txt) { el = node; break; }
          }
        }
        if (!el) return null;
        (el as HTMLElement).click();
        return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), href: (el as HTMLAnchorElement).href ?? null };
      },
      args: [selector, text],
    });

    const clicked = result?.[0]?.result;
    if (!clicked) throw Object.assign(new Error('Element not found'), { code: 'CONTENT_UNAVAILABLE' });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, element: clicked }) }] };
  },

  async extract_table(params) {
    const selector = params.selector as string | undefined;
    const index = (params.index as number) ?? 0;
    const tab = await getActiveTab();

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: (sel: string | undefined, idx: number) => {
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
