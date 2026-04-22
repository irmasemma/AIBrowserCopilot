/**
 * Content script: reads all form fields on the page and returns structured JSON.
 * Injected via chrome.scripting.executeScript().
 */

export interface FormFieldInfo {
  selector: string;
  type: string;
  label: string | null;
  placeholder: string | null;
  name: string | null;
  id: string | null;
  required: boolean;
  value: string;
  ariaLabel: string | null;
  options?: Array<{ value: string; text: string }>;
  accept?: string | null;
}

export interface FormInfo {
  selector: string;
  action: string | null;
  method: string | null;
  fields: FormFieldInfo[];
}

export interface ReadFormResult {
  forms: FormInfo[];
}

/**
 * Build a unique CSS selector for an element.
 */
function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute('name');
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;

  // Use type + nth-of-type as fallback
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      const parentSelector = parent.id ? `#${CSS.escape(parent.id)}` : tag;
      return `${parentSelector} > ${tag}:nth-of-type(${idx})`;
    }
  }
  return tag;
}

/**
 * Find label text for a form field.
 */
function findLabel(el: Element): string | null {
  // 1. aria-label attribute
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 2. <label for="id">
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return label.textContent?.trim() ?? null;
  }

  // 3. Wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Get label text excluding the input's own text
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 4. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map(rid => document.getElementById(rid)?.textContent?.trim()).filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  // 5. Placeholder as last resort
  return (el as HTMLInputElement).placeholder || null;
}

/**
 * Extract info from a single form field element.
 */
function extractFieldInfo(el: Element): FormFieldInfo {
  const input = el as HTMLInputElement;
  const type = el.tagName.toLowerCase() === 'select' ? 'select'
    : el.tagName.toLowerCase() === 'textarea' ? 'textarea'
    : el.hasAttribute('contenteditable') ? 'contenteditable'
    : input.type || 'text';

  const field: FormFieldInfo = {
    selector: buildSelector(el),
    type,
    label: findLabel(el),
    placeholder: input.placeholder || null,
    name: input.name || null,
    id: el.id || null,
    required: input.required ?? el.getAttribute('aria-required') === 'true',
    value: el.tagName.toLowerCase() === 'select'
      ? (el as HTMLSelectElement).value
      : el.hasAttribute('contenteditable')
        ? (el as HTMLElement).textContent ?? ''
        : input.value ?? '',
    ariaLabel: el.getAttribute('aria-label'),
  };

  // Options for select elements
  if (el.tagName.toLowerCase() === 'select') {
    field.options = Array.from((el as HTMLSelectElement).options).map(opt => ({
      value: opt.value,
      text: opt.textContent?.trim() ?? '',
    }));
  }

  // Accept for file inputs
  if (type === 'file') {
    field.accept = input.accept || null;
  }

  return field;
}

/**
 * Main function to read all form fields. Injected as content script.
 */
export function readFormFields(targetSelector?: string): ReadFormResult {
  const fieldSelectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [contenteditable="true"], [contenteditable=""]';

  const forms: FormInfo[] = [];

  // Process <form> elements
  const formElements = targetSelector
    ? Array.from(document.querySelectorAll(targetSelector)).filter(el => el.tagName.toLowerCase() === 'form')
    : Array.from(document.querySelectorAll('form'));

  for (const form of formElements) {
    const formEl = form as HTMLFormElement;
    const fields = Array.from(formEl.querySelectorAll(fieldSelectors)).map(extractFieldInfo);
    if (fields.length === 0) continue;

    forms.push({
      selector: buildSelector(formEl),
      action: formEl.action || null,
      method: formEl.method?.toUpperCase() || null,
      fields,
    });
  }

  // Detect fields NOT inside any <form> tag (common in SPAs)
  const orphanFields = Array.from(document.querySelectorAll(fieldSelectors))
    .filter(el => !el.closest('form'))
    .map(extractFieldInfo);

  if (orphanFields.length > 0) {
    forms.push({
      selector: 'body',
      action: null,
      method: null,
      fields: orphanFields,
    });
  }

  return { forms };
}
