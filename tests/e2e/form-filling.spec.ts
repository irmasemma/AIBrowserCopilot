/**
 * E2E tests for fill_form, read_form, and click_element tools
 * on simple HTML, React-style, Vue-style, and edge-case form pages.
 *
 * Uses the real Chrome extension loaded via chrome.scripting.executeScript.
 */
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const extensionPath = path.resolve(__dirname, '../../packages/extension/dist/chrome-mv3');

const fixturePath = (name: string) => path.resolve(__dirname, `fixtures/${name}`);

let context: BrowserContext;
let extensionId: string;
let extPage: Page; // Extension page for running chrome.scripting calls

// ==========================================
// SETUP / TEARDOWN
// ==========================================

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
    ],
  });

  await new Promise((r) => setTimeout(r, 3000));

  const sws = context.serviceWorkers();
  if (sws.length > 0) {
    extensionId = sws[0].url().split('/')[2];
  }
  if (!extensionId) {
    try {
      const sw = await context.waitForEvent('serviceworker', { timeout: 5000 });
      extensionId = sw.url().split('/')[2];
    } catch { /* fallback */ }
  }
  expect(extensionId).toBeTruthy();

  extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await extPage.waitForTimeout(1000);
});

test.afterAll(async () => {
  await context?.close();
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/** Get the Chrome tab ID for a page by matching its title */
async function getTabId(titleSubstring: string): Promise<number> {
  const tabId = await extPage.evaluate(async (title) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.title?.includes(title));
    return tab?.id ?? 0;
  }, titleSubstring);
  expect(tabId).toBeGreaterThan(0);
  return tabId;
}

/** read_form: reads all form fields from a tab */
async function readForm(tabId: number): Promise<{ fields: Array<{
  selector: string; type: string; label: string | null;
  placeholder: string | null; name: string | null; id: string | null; value: string;
}> }> {
  const result = await extPage.evaluate(async (tid) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: () => {
        const fieldSelectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, [contenteditable="true"]';
        const fields = Array.from(document.querySelectorAll(fieldSelectors)).map(el => {
          const input = el as HTMLInputElement;
          let label = el.getAttribute('aria-label') || null;
          if (!label && el.id) {
            const labelEl = document.querySelector(`label[for="${el.id}"]`);
            if (labelEl) label = labelEl.textContent?.trim() || null;
          }
          if (!label) {
            const parentLabel = el.closest('label');
            if (parentLabel) {
              const clone = parentLabel.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
              label = clone.textContent?.trim() || null;
            }
          }
          return {
            selector: el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}[name="${input.name}"]`,
            type: el.tagName.toLowerCase() === 'select' ? 'select' : (el.getAttribute('contenteditable') === 'true' ? 'contenteditable' : input.type || 'text'),
            label,
            placeholder: input.placeholder || null,
            name: input.name || null,
            id: el.id || null,
            value: el.getAttribute('contenteditable') === 'true' ? (el.textContent || '') : (input.value || ''),
          };
        });
        return { fields };
      },
    });
    return results?.[0]?.result;
  }, tabId);
  return result as any;
}

/** fill_form: fill fields using CSS selectors and the native value setter for React/Vue compat */
async function fillForm(tabId: number, fields: Array<{ selector: string; value: string }>): Promise<Array<{ selector: string; success: boolean; error?: string }>> {
  const result = await extPage.evaluate(async ({ tid, f }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (fieldList: Array<{ selector: string; value: string }>) => {
        const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

        return fieldList.map(({ selector, value }) => {
          const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
          if (!el) return { selector, success: false, error: 'Element not found' };
          if ((el as HTMLInputElement).disabled) return { selector, success: false, error: 'Element is disabled' };

          if (el instanceof HTMLTextAreaElement && textareaSetter) {
            textareaSetter.call(el, value);
          } else if (el instanceof HTMLSelectElement && selectSetter) {
            selectSetter.call(el, value);
          } else if (inputSetter) {
            inputSetter.call(el, value);
          } else {
            el.value = value;
          }

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { selector, success: true };
        });
      },
      args: [f],
    });
    return results?.[0]?.result;
  }, { tid: tabId, f: fields });
  return result as any;
}

/** fill_form variant for select elements */
async function fillSelect(tabId: number, selector: string, value: string): Promise<boolean> {
  const result = await extPage.evaluate(async ({ tid, sel, val }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (s: string, v: string) => {
        const el = document.querySelector(s) as HTMLSelectElement | null;
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [sel, val],
    });
    return results?.[0]?.result;
  }, { tid: tabId, sel: selector, val: value });
  return result as boolean;
}

/** fill_form variant for checkboxes / radio buttons */
async function setChecked(tabId: number, selector: string, checked: boolean): Promise<boolean> {
  const result = await extPage.evaluate(async ({ tid, sel, chk }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (s: string, c: boolean) => {
        const el = document.querySelector(s) as HTMLInputElement | null;
        if (!el) return false;
        el.checked = c;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      args: [sel, chk],
    });
    return results?.[0]?.result;
  }, { tid: tabId, sel: selector, chk: checked });
  return result as boolean;
}

/** click_element: click by visible text with optional index */
async function clickElement(tabId: number, text: string, index?: number): Promise<{ tag: string; text: string; matchCount: number } | null> {
  const idx = index ?? 0;
  const result = await extPage.evaluate(async ({ tid, txt, i }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (t: string, idx: number) => {
        const clickable = 'a, button, input[type="submit"], input[type="button"], [role="button"], [onclick], summary';
        const target = t.toLowerCase();
        const matches = Array.from(document.querySelectorAll(clickable)).filter(el =>
          (el.textContent?.trim().toLowerCase() ?? '').includes(target)
        );
        if (matches.length <= idx) return null;
        const el = matches[idx] as HTMLElement;
        el.click();
        return { tag: el.tagName, text: el.textContent?.trim().slice(0, 100), matchCount: matches.length };
      },
      args: [txt, i],
    });
    return results?.[0]?.result;
  }, { tid: tabId, txt: text, i: idx });
  return result as any;
}

/** Fill a contenteditable element */
async function fillContenteditable(tabId: number, selector: string, text: string): Promise<boolean> {
  const result = await extPage.evaluate(async ({ tid, sel, txt }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (s: string, t: string) => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (!el) return false;
        el.textContent = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [sel, txt],
    });
    return results?.[0]?.result;
  }, { tid: tabId, sel: selector, txt: text });
  return result as boolean;
}

/** Trigger blur on an element (for blur-validation) */
async function triggerBlur(tabId: number, selector: string): Promise<void> {
  await extPage.evaluate(async ({ tid, sel }) => {
    await chrome.scripting.executeScript({
      target: { tabId: tid },
      func: (s: string) => {
        const el = document.querySelector(s) as HTMLElement;
        if (el) {
          el.focus();
          el.blur();
        }
      },
      args: [sel],
    });
  }, { tid: tabId, sel: selector });
}

// ==========================================
// FORM-SIMPLE.HTML TESTS
// ==========================================

test.describe('form-simple.html', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(`file://${fixturePath('form-simple.html')}`);
    await page.waitForTimeout(500);
    tabId = await getTabId('Simple Forms');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('read_form returns all fields with correct labels, types, and selectors', async () => {
    const formData = await readForm(tabId);

    expect(formData).toBeTruthy();
    expect(formData.fields.length).toBeGreaterThanOrEqual(10);

    // Check specific fields by ID
    const fullNameField = formData.fields.find(f => f.id === 'full-name');
    expect(fullNameField).toBeTruthy();
    expect(fullNameField!.type).toBe('text');
    expect(fullNameField!.selector).toBe('#full-name');
    expect(fullNameField!.label).toContain('Full name'); // aria-label

    const emailField = formData.fields.find(f => f.id === 'email');
    expect(emailField).toBeTruthy();
    expect(emailField!.type).toBe('email');
    expect(emailField!.label).toContain('Email');

    const countryField = formData.fields.find(f => f.id === 'country');
    expect(countryField).toBeTruthy();
    expect(countryField!.type).toBe('select');

    const bioField = formData.fields.find(f => f.id === 'bio');
    expect(bioField).toBeTruthy();
    expect(bioField!.selector).toBe('#bio');

    // Check radio buttons exist
    const radios = formData.fields.filter(f => f.type === 'radio');
    expect(radios.length).toBeGreaterThanOrEqual(4);

    // Check checkboxes exist
    const checkboxes = formData.fields.filter(f => f.type === 'checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  test('fills text, email, and URL fields by selector', async () => {
    const results = await fillForm(tabId, [
      { selector: '#full-name', value: 'Jane Doe' },
      { selector: '#email', value: 'jane@example.com' },
      { selector: '#website', value: 'https://janedoe.dev' },
    ]);

    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.success).toBe(true));

    expect(await page.inputValue('#full-name')).toBe('Jane Doe');
    expect(await page.inputValue('#email')).toBe('jane@example.com');
    expect(await page.inputValue('#website')).toBe('https://janedoe.dev');
  });

  test('selects dropdown option', async () => {
    const success = await fillSelect(tabId, '#country', 'ca');
    expect(success).toBe(true);

    expect(await page.inputValue('#country')).toBe('ca');

    const selectedText = await page.evaluate(() => {
      const sel = document.querySelector('#country') as HTMLSelectElement;
      return sel.options[sel.selectedIndex].text;
    });
    expect(selectedText).toBe('Canada');
  });

  test('checks and unchecks checkboxes', async () => {
    await setChecked(tabId, 'input[name="newsletter"]', true);
    expect(await page.isChecked('input[name="newsletter"]')).toBe(true);

    await setChecked(tabId, 'input[name="newsletter"]', false);
    expect(await page.isChecked('input[name="newsletter"]')).toBe(false);

    await setChecked(tabId, 'input[name="terms"]', true);
    expect(await page.isChecked('input[name="terms"]')).toBe(true);
  });

  test('clicks radio buttons', async () => {
    await setChecked(tabId, 'input[name="gender"][value="female"]', true);
    expect(await page.isChecked('input[name="gender"][value="female"]')).toBe(true);

    await setChecked(tabId, 'input[name="gender"][value="other"]', true);
    expect(await page.isChecked('input[name="gender"][value="other"]')).toBe(true);
  });

  test('fills textarea', async () => {
    const results = await fillForm(tabId, [
      { selector: '#bio', value: 'I am a software developer who loves testing forms.' },
    ]);

    expect(results[0].success).toBe(true);
    expect(await page.inputValue('#bio')).toBe('I am a software developer who loves testing forms.');
  });

  test('submits contact form and verifies results div', async () => {
    await fillForm(tabId, [
      { selector: '#full-name', value: 'Test User' },
      { selector: '#email', value: 'test@example.com' },
      { selector: '#password', value: 'securepass123' },
    ]);
    await setChecked(tabId, 'input[name="terms"]', true);
    await fillForm(tabId, [{ selector: '#bio', value: 'A test bio' }]);
    await fillSelect(tabId, '#country', 'us');

    // Click Submit (first one on the page)
    const clickResult = await clickElement(tabId, 'Submit', 0);
    expect(clickResult).toBeTruthy();

    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('contact-form');
    expect(resultsText).toContain('Test User');
    expect(resultsText).toContain('test@example.com');
    expect(resultsText).toContain('A test bio');
  });

  test('fills required fields without validation errors', async () => {
    await fillForm(tabId, [
      { selector: '#full-name', value: 'Valid Name' },
      { selector: '#email', value: 'valid@email.com' },
      { selector: '#password', value: 'validpassword' },
    ]);
    await setChecked(tabId, 'input[name="terms"]', true);

    const isValid = await extPage.evaluate(async (tid) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const form = document.getElementById('contact-form') as HTMLFormElement;
          return form.checkValidity();
        },
      });
      return results?.[0]?.result;
    }, tabId);

    expect(isValid).toBe(true);
  });

  test('fills preferences form with number, range, and select', async () => {
    await fillForm(tabId, [
      { selector: '#experience', value: '10' },
      { selector: '#satisfaction', value: '85' },
    ]);
    await fillSelect(tabId, '#priority', 'high');

    expect(await page.inputValue('#experience')).toBe('10');
    expect(await page.inputValue('#satisfaction')).toBe('85');
    expect(await page.inputValue('#priority')).toBe('high');

    // Verify the range display updated (oninput handler)
    const displayText = await page.textContent('#satisfaction-value');
    expect(displayText).toBe('85');
  });

  test('submits preferences form and verifies results', async () => {
    await fillForm(tabId, [{ selector: '#experience', value: '7' }]);
    await fillSelect(tabId, '#priority', 'critical');
    await setChecked(tabId, 'input[name="languages"][value="typescript"]', true);
    await setChecked(tabId, 'input[name="languages"][value="rust"]', true);

    const clickResult = await clickElement(tabId, 'Save Preferences');
    expect(clickResult).toBeTruthy();

    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('preferences-form');
    expect(resultsText).toContain('critical');
  });
});

// ==========================================
// FORM-REACT.HTML TESTS
// ==========================================

test.describe('form-react.html', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(`file://${fixturePath('form-react.html')}`);
    await page.waitForTimeout(500);
    tabId = await getTabId('React');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('fills controlled inputs and verifies React state updates', async () => {
    const results = await fillForm(tabId, [
      { selector: '#product-name', value: 'CoPilot Pro' },
      { selector: '#tagline', value: 'AI meets browser' },
      { selector: '#website-url', value: 'https://copilotpro.dev' },
    ]);

    results.forEach(r => expect(r.success).toBe(true));

    expect(await page.inputValue('#product-name')).toBe('CoPilot Pro');
    expect(await page.inputValue('#tagline')).toBe('AI meets browser');
    expect(await page.inputValue('#website-url')).toBe('https://copilotpro.dev');

    // Verify React internal state was updated via __reactEvents
    const stateUpdated = await page.evaluate(() => {
      return (window as any).__reactEvents?.some((e: any) => e.id === 'product-name' && e.value === 'CoPilot Pro');
    });
    expect(stateUpdated).toBe(true);
  });

  test('fills textarea and verifies state', async () => {
    const results = await fillForm(tabId, [
      { selector: '#description', value: 'A powerful browser extension that connects AI to your tabs.' },
    ]);

    expect(results[0].success).toBe(true);
    expect(await page.inputValue('#description')).toBe('A powerful browser extension that connects AI to your tabs.');
  });

  test('selects category dropdown and triggers validation', async () => {
    const success = await fillSelect(tabId, '#category', 'ai');
    expect(success).toBe(true);
    expect(await page.inputValue('#category')).toBe('ai');
  });

  test('checkbox toggle enables submit button', async () => {
    // Fill required fields
    await fillForm(tabId, [
      { selector: '#product-name', value: 'Test Product' },
      { selector: '#description', value: 'A test description' },
    ]);
    await fillSelect(tabId, '#category', 'dev-tools');
    await page.waitForTimeout(200);

    // Submit should still be disabled (checkbox not checked)
    let isDisabled = await page.evaluate(() =>
      (document.getElementById('submit-btn') as HTMLButtonElement).disabled
    );
    expect(isDisabled).toBe(true);

    // Check the agree checkbox
    await setChecked(tabId, '#agree-terms', true);
    await page.waitForTimeout(200);

    // Now submit should be enabled
    isDisabled = await page.evaluate(() =>
      (document.getElementById('submit-btn') as HTMLButtonElement).disabled
    );
    expect(isDisabled).toBe(false);
  });

  test('form validation shows error for short product name', async () => {
    await fillForm(tabId, [{ selector: '#product-name', value: 'AB' }]);
    await page.waitForTimeout(200);

    const errorText = await page.textContent('#product-name-error');
    expect(errorText).toContain('at least 3 characters');
  });

  test('form validation clears error when name is long enough', async () => {
    await fillForm(tabId, [{ selector: '#product-name', value: 'AB' }]);
    await page.waitForTimeout(200);
    expect(await page.textContent('#product-name-error')).toContain('at least 3');

    await fillForm(tabId, [{ selector: '#product-name', value: 'Valid Name' }]);
    await page.waitForTimeout(200);
    expect(await page.textContent('#product-name-error')).toBe('');
  });

  test('fills entire form and submits via click', async () => {
    await fillForm(tabId, [
      { selector: '#product-name', value: 'Pilotwave' },
      { selector: '#tagline', value: 'Connect AI to your browser' },
      { selector: '#description', value: 'A Chrome extension for AI integration.' },
      { selector: '#website-url', value: 'https://aibrowsercopilot.com' },
    ]);
    await fillSelect(tabId, '#category', 'ai');
    await setChecked(tabId, '#agree-terms', true);
    await page.waitForTimeout(300);

    const clickResult = await clickElement(tabId, 'Submit Product');
    expect(clickResult).toBeTruthy();

    await page.waitForTimeout(300);

    const output = await page.textContent('#form-output');
    expect(output).toContain('Pilotwave');
    expect(output).toContain('ai');
    expect(output).toContain('true'); // agree-terms
  });
});

// ==========================================
// FORM-VUE.HTML TESTS
// ==========================================

test.describe('form-vue.html', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(`file://${fixturePath('form-vue.html')}`);
    // Vue 3 CDN needs time to load and mount
    await page.waitForTimeout(2000);
    tabId = await getTabId('Vue Forms');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('fills v-model inputs and verifies computed values via rendered output', async () => {
    // Use Playwright's fill() which triggers input events that Vue v-model listens to
    // but we test via the extension's chrome.scripting approach
    await fillForm(tabId, [
      { selector: '#vue-name', value: 'Alice Smith' },
      { selector: '#vue-email', value: 'alice@example.com' },
    ]);
    await page.waitForTimeout(300);

    expect(await page.inputValue('#vue-name')).toBe('Alice Smith');
    expect(await page.inputValue('#vue-email')).toBe('alice@example.com');
  });

  test('triggers conditional fields by selecting business account type', async () => {
    // Initially company fields should not exist (v-if removes them from DOM)
    let companyExists = await page.evaluate(() => !!document.getElementById('vue-company'));
    expect(companyExists).toBe(false);

    // Select "business" account type
    await fillSelect(tabId, '#vue-account-type', 'business');
    await page.waitForTimeout(500);

    // Company and employees fields should now appear
    companyExists = await page.evaluate(() => !!document.getElementById('vue-company'));
    expect(companyExists).toBe(true);

    const employeesExists = await page.evaluate(() => !!document.getElementById('vue-employees'));
    expect(employeesExists).toBe(true);

    // Contract ID should NOT appear (enterprise only)
    const contractExists = await page.evaluate(() => !!document.getElementById('vue-contract-id'));
    expect(contractExists).toBe(false);
  });

  test('triggers enterprise-only fields', async () => {
    await fillSelect(tabId, '#vue-account-type', 'enterprise');
    await page.waitForTimeout(500);

    // All conditional fields should appear
    expect(await page.evaluate(() => !!document.getElementById('vue-company'))).toBe(true);
    expect(await page.evaluate(() => !!document.getElementById('vue-employees'))).toBe(true);
    expect(await page.evaluate(() => !!document.getElementById('vue-contract-id'))).toBe(true);

    // Fill the enterprise-only field
    await fillForm(tabId, [{ selector: '#vue-contract-id', value: 'ENT-1234-5678' }]);
    await page.waitForTimeout(200);
    expect(await page.inputValue('#vue-contract-id')).toBe('ENT-1234-5678');
  });

  test('conditional fields disappear when switching back to personal', async () => {
    // Show conditional fields
    await fillSelect(tabId, '#vue-account-type', 'business');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => !!document.getElementById('vue-company'))).toBe(true);

    // Switch back to personal
    await fillSelect(tabId, '#vue-account-type', 'personal');
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => !!document.getElementById('vue-company'))).toBe(false);
  });

  test('autocomplete: type partial text and select suggestion', async () => {
    // Type "San" to trigger autocomplete suggestions
    await fillForm(tabId, [{ selector: '#vue-city', value: 'San' }]);

    // Trigger the @input handler by dispatching input event
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const input = document.getElementById('vue-city') as HTMLInputElement;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
      });
    }, tabId);
    await page.waitForTimeout(500);

    // Check for autocomplete dropdown
    const suggestionsVisible = await page.evaluate(() => {
      return document.querySelectorAll('.autocomplete-item').length > 0;
    });
    expect(suggestionsVisible).toBe(true);

    // Click the first suggestion via mousedown (Vue uses @mousedown.prevent)
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const items = document.querySelectorAll('.autocomplete-item');
          if (items.length > 0) {
            (items[0] as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          }
        },
      });
    }, tabId);
    await page.waitForTimeout(300);

    // The city input should have the selected city value
    const cityValue = await page.inputValue('#vue-city');
    expect(cityValue.length).toBeGreaterThan(0);
    expect(cityValue.toLowerCase()).toContain('san');
  });

  test('adds tags via Enter key', async () => {
    const addTag = async (tagText: string) => {
      await fillForm(tabId, [{ selector: '#vue-tags-input', value: tagText }]);
      await page.waitForTimeout(100);
      // Simulate Enter keydown which Vue listens to via @keydown.enter.prevent
      await extPage.evaluate(async (tid) => {
        await chrome.scripting.executeScript({
          target: { tabId: tid },
          func: () => {
            const input = document.getElementById('vue-tags-input') as HTMLInputElement;
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          },
        });
      }, tabId);
      await page.waitForTimeout(200);
    };

    await addTag('JavaScript');
    await addTag('TypeScript');
    await addTag('Rust');

    // Verify tags are rendered in the DOM
    const tags = await page.evaluate(() => {
      const tagEls = document.querySelectorAll('.tag');
      return Array.from(tagEls).map(t => t.textContent?.trim().replace(/\u00d7$/, '').trim());
    });
    expect(tags).toContain('JavaScript');
    expect(tags).toContain('TypeScript');
    expect(tags).toContain('Rust');
  });

  test('sets star rating', async () => {
    // Click the 4th star
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const stars = document.querySelectorAll('#star-rating .star');
          if (stars.length >= 4) (stars[3] as HTMLElement).click(); // 0-indexed, 4th star
        },
      });
    }, tabId);
    await page.waitForTimeout(300);

    // Verify the rating display text
    const ratingText = await page.evaluate(() => {
      // Look for text like "4 / 5"
      const body = document.body.textContent || '';
      const match = body.match(/(\d+)\s*\/\s*5/);
      return match ? match[1] : null;
    });
    expect(ratingText).toBe('4');

    // Verify filled stars
    const filledCount = await page.evaluate(() => {
      return document.querySelectorAll('#star-rating .star.filled').length;
    });
    expect(filledCount).toBe(4);
  });

  test('submits all forms and verifies reactive data in results', async () => {
    // Fill profile
    await fillForm(tabId, [
      { selector: '#vue-name', value: 'Bob Builder' },
      { selector: '#vue-email', value: 'bob@build.com' },
    ]);
    await fillSelect(tabId, '#vue-account-type', 'personal');
    await fillForm(tabId, [{ selector: '#vue-bio', value: 'I build things' }]);
    await page.waitForTimeout(300);

    // Set rating
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const stars = document.querySelectorAll('#star-rating .star');
          if (stars.length >= 5) (stars[4] as HTMLElement).click();
        },
      });
    }, tabId);
    await page.waitForTimeout(200);

    // Click "Submit All Forms"
    const clickResult = await clickElement(tabId, 'Submit All Forms');
    expect(clickResult).toBeTruthy();
    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('Bob Builder');
    expect(resultsText).toContain('bob@build.com');
    expect(resultsText).toContain('personal');
  });
});

// ==========================================
// FORM-EDGE-CASES.HTML TESTS
// ==========================================

test.describe('form-edge-cases.html', () => {
  let page: Page;
  let tabId: number;

  test.beforeEach(async () => {
    page = await context.newPage();
    await page.goto(`file://${fixturePath('form-edge-cases.html')}`);
    await page.waitForTimeout(500);
    tabId = await getTabId('Edge Cases');
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ---- Contenteditable ----

  test('read_form detects contenteditable divs', async () => {
    const formData = await readForm(tabId);
    const richEditor = formData.fields.find(f => f.id === 'rich-editor');
    expect(richEditor).toBeTruthy();
    expect(richEditor!.type).toBe('contenteditable');

    const singleLine = formData.fields.find(f => f.id === 'single-line-editor');
    expect(singleLine).toBeTruthy();
    expect(singleLine!.type).toBe('contenteditable');
  });

  test('fills contenteditable div', async () => {
    const success = await fillContenteditable(tabId, '#rich-editor', 'This is rich text content.');
    expect(success).toBe(true);

    const content = await page.textContent('#rich-editor');
    expect(content).toBe('This is rich text content.');
  });

  test('fills single-line contenteditable', async () => {
    const success = await fillContenteditable(tabId, '#single-line-editor', 'Single line value');
    expect(success).toBe(true);

    const content = await page.textContent('#single-line-editor');
    expect(content).toBe('Single line value');
  });

  test('reads contenteditable values via click', async () => {
    await fillContenteditable(tabId, '#rich-editor', 'Hello World');
    await fillContenteditable(tabId, '#single-line-editor', 'One liner');

    const clickResult = await clickElement(tabId, 'Read Rich Text');
    expect(clickResult).toBeTruthy();

    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('Hello World');
    expect(resultsText).toContain('One liner');
  });

  // ---- Unlabeled fields ----

  test('interacts with fields that have no labels (only name attribute)', async () => {
    const formData = await readForm(tabId);

    const alphaField = formData.fields.find(f => f.name === 'field_alpha');
    expect(alphaField).toBeTruthy();
    expect(alphaField!.label).toBeNull(); // no label element, no aria-label

    // Fill them by name-based selectors
    const results = await fillForm(tabId, [
      { selector: 'input[name="field_alpha"]', value: 'alpha_value' },
      { selector: 'input[name="field_beta"]', value: 'beta_value' },
      { selector: 'input[name="field_gamma"]', value: 'gamma_value' },
    ]);

    results.forEach(r => expect(r.success).toBe(true));

    expect(await page.inputValue('input[name="field_alpha"]')).toBe('alpha_value');
    expect(await page.inputValue('input[name="field_beta"]')).toBe('beta_value');
    expect(await page.inputValue('input[name="field_gamma"]')).toBe('gamma_value');
  });

  test('fills unlabeled select by name', async () => {
    await fillSelect(tabId, 'select[name="field_delta"]', 'opt2');
    expect(await page.inputValue('select[name="field_delta"]')).toBe('opt2');
  });

  // ---- Disabled fields ----

  test('disabled shipping fields cannot be filled', async () => {
    const results = await fillForm(tabId, [
      { selector: '#shipping-street', value: '123 Main St' },
      { selector: '#shipping-city', value: 'Springfield' },
      { selector: '#shipping-zip', value: '90210' },
    ]);

    results.forEach(r => {
      expect(r.success).toBe(false);
      expect(r.error).toBe('Element is disabled');
    });

    // Values should remain empty
    expect(await page.inputValue('#shipping-street')).toBe('');
  });

  test('fields enable after checkbox is checked, then can be filled', async () => {
    // Enable shipping via checkbox
    await setChecked(tabId, '#enable-shipping', true);
    await page.waitForTimeout(200);

    // Verify fields are no longer disabled
    const streetDisabled = await page.evaluate(() =>
      (document.getElementById('shipping-street') as HTMLInputElement).disabled
    );
    expect(streetDisabled).toBe(false);

    // Now fill them
    const results = await fillForm(tabId, [
      { selector: '#shipping-street', value: '456 Oak Avenue' },
      { selector: '#shipping-city', value: 'Portland' },
      { selector: '#shipping-zip', value: '97201' },
    ]);

    results.forEach(r => expect(r.success).toBe(true));

    expect(await page.inputValue('#shipping-street')).toBe('456 Oak Avenue');
    expect(await page.inputValue('#shipping-city')).toBe('Portland');
    expect(await page.inputValue('#shipping-zip')).toBe('97201');
  });

  test('reads shipping values via button click after filling', async () => {
    await setChecked(tabId, '#enable-shipping', true);
    await page.waitForTimeout(200);

    await fillForm(tabId, [
      { selector: '#shipping-street', value: '789 Pine St' },
      { selector: '#shipping-city', value: 'Seattle' },
      { selector: '#shipping-zip', value: '98101' },
    ]);

    await clickElement(tabId, 'Read Shipping');
    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('789 Pine St');
    expect(resultsText).toContain('Seattle');
    expect(resultsText).toContain('98101');
    expect(resultsText).toContain('"enabled": true');
  });

  // ---- Hidden fields revealed on interaction ----

  test('hidden fields become fillable after reveal', async () => {
    // Select "Yes" to reveal hidden fields
    await fillSelect(tabId, '#reveal-trigger', 'yes');
    await page.waitForTimeout(500); // CSS transition

    // Fill the revealed fields
    const results = await fillForm(tabId, [
      { selector: '#referral-code', value: 'REF-ABC123' },
      { selector: '#referrer-name', value: 'John Referrer' },
    ]);

    results.forEach(r => expect(r.success).toBe(true));

    expect(await page.inputValue('#referral-code')).toBe('REF-ABC123');
    expect(await page.inputValue('#referrer-name')).toBe('John Referrer');

    // Read via button
    await clickElement(tabId, 'Read Hidden Form');
    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('REF-ABC123');
    expect(resultsText).toContain('John Referrer');
    expect(resultsText).toContain('"revealed": true');
  });

  // ---- Multiple identical submit buttons ----

  test('handles multiple identical Submit buttons via index', async () => {
    await fillForm(tabId, [{ selector: '#multi-btn-input', value: 'My Value' }]);

    // Click the first "Submit" button (save-draft)
    const result1 = await clickElement(tabId, 'Submit', 0);
    expect(result1).toBeTruthy();
    await page.waitForTimeout(300);

    let resultsText = await page.textContent('#results');
    // The first Submit in the section should trigger save-draft
    // (note: the page has other submit buttons too, so the index may vary)
    expect(resultsText).toContain('My Value');
  });

  test('click_element reports match count for ambiguous Submit text', async () => {
    const result = await clickElement(tabId, 'Submit', 0);
    expect(result).toBeTruthy();
    // Multiple buttons with "Submit" text exist on the page
    expect(result!.matchCount).toBeGreaterThanOrEqual(3);
  });

  // ---- Long auto-generated class names ----

  test('fills fields with long auto-generated class names by ID', async () => {
    const results = await fillForm(tabId, [
      { selector: '#long-class-input', value: 'admin_user' },
    ]);

    expect(results[0].success).toBe(true);
    expect(await page.inputValue('#long-class-input')).toBe('admin_user');

    await fillSelect(tabId, '#long-class-select', 'eng');
    expect(await page.inputValue('#long-class-select')).toBe('eng');
  });

  // ---- Shadow DOM ----

  test('shadow DOM inputs are not reachable via document.querySelector', async () => {
    // Standard querySelector cannot reach inside shadow DOM
    const results = await fillForm(tabId, [
      { selector: '#shadow-name input', value: 'Test' },
    ]);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Element not found');
  });

  test('shadow DOM values can be set via custom element property', async () => {
    // Use the custom element's value setter
    await extPage.evaluate(async (tid) => {
      await chrome.scripting.executeScript({
        target: { tabId: tid },
        func: () => {
          const el = document.getElementById('shadow-name') as any;
          if (el) el.value = 'Shadow Name Value';
          const el2 = document.getElementById('shadow-email') as any;
          if (el2) el2.value = 'shadow@test.com';
        },
      });
    }, tabId);
    await page.waitForTimeout(200);

    // Read back via the custom element's getter
    const values = await page.evaluate(() => {
      return {
        name: (document.getElementById('shadow-name') as any).value,
        email: (document.getElementById('shadow-email') as any).value,
      };
    });

    expect(values.name).toBe('Shadow Name Value');
    expect(values.email).toBe('shadow@test.com');

    // Verify via the "Read Shadow Values" button
    await clickElement(tabId, 'Read Shadow Values');
    await page.waitForTimeout(300);

    const resultsText = await page.textContent('#results');
    expect(resultsText).toContain('Shadow Name Value');
    expect(resultsText).toContain('shadow@test.com');
  });

  // ---- Blur validation ----

  test('blur validation shows inline errors for invalid values', async () => {
    // Fill with invalid values
    await fillForm(tabId, [{ selector: '#val-username', value: 'ab' }]); // too short
    await triggerBlur(tabId, '#val-username');
    await page.waitForTimeout(200);

    const usernameError = await page.textContent('#val-username-error');
    expect(usernameError).toContain('at least 3 characters');

    // Verify the input has the invalid class
    const hasInvalidClass = await page.evaluate(() =>
      document.getElementById('val-username')?.classList.contains('invalid')
    );
    expect(hasInvalidClass).toBe(true);
  });

  test('blur validation clears errors for valid values', async () => {
    // First trigger error
    await fillForm(tabId, [{ selector: '#val-email', value: 'notanemail' }]);
    await triggerBlur(tabId, '#val-email');
    await page.waitForTimeout(200);

    let emailError = await page.textContent('#val-email-error');
    expect(emailError).toContain('Invalid email');

    // Fix the value
    await fillForm(tabId, [{ selector: '#val-email', value: 'valid@example.com' }]);
    await triggerBlur(tabId, '#val-email');
    await page.waitForTimeout(200);

    emailError = await page.textContent('#val-email-error');
    expect(emailError).toBe('');
  });

  // ---- read_form filtering ----

  test('read_form does not include hidden or submit/button/reset inputs', async () => {
    const formData = await readForm(tabId);

    const hiddenFields = formData.fields.filter(f => f.type === 'hidden');
    expect(hiddenFields.length).toBe(0);

    const buttonFields = formData.fields.filter(f =>
      f.type === 'submit' || f.type === 'button' || f.type === 'reset'
    );
    expect(buttonFields.length).toBe(0);
  });
});
