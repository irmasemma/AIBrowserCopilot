import { describe, it, expect } from 'vitest';
import { toolRegistry } from './index.js';
import { fillForm } from './fill-form.js';
import { clickElement } from './click-element.js';
import { pressKey } from './press-key.js';

describe('tool registry', () => {
  it('exposes press_key as a top-level tool', () => {
    expect(toolRegistry.find(t => t.name === 'press_key')).toBeDefined();
  });

  it('exposes fill_form, click_element, press_key, snapshot together', () => {
    const names = toolRegistry.map(t => t.name);
    expect(names).toContain('snapshot');
    expect(names).toContain('fill_form');
    expect(names).toContain('click_element');
    expect(names).toContain('press_key');
  });
});

describe('fill_form schema', () => {
  it('accepts the new ref/name/checked/values fields per item', () => {
    const fields = fillForm.inputSchema.fields;
    // zod's _def.innerType.element exposes the per-field shape after .array().describe()
    const elementSchema = (fields as any)._def?.innerType?.element || (fields as any)._def?.type;
    const shape = elementSchema?._def?.shape?.() ?? elementSchema?.shape;
    expect(shape).toBeDefined();
    expect(shape).toHaveProperty('ref');
    expect(shape).toHaveProperty('name');
    expect(shape).toHaveProperty('checked');
    expect(shape).toHaveProperty('values');
    // Backward-compat: existing fields preserved
    expect(shape).toHaveProperty('selector');
    expect(shape).toHaveProperty('label');
    expect(shape).toHaveProperty('role');
    expect(shape).toHaveProperty('placeholder');
    expect(shape).toHaveProperty('value');
    expect(shape).toHaveProperty('type');
  });

  it('description recommends ref locator and snapshot first', () => {
    expect(fillForm.description.toLowerCase()).toContain('ref');
    expect(fillForm.description.toLowerCase()).toContain('snapshot');
  });
});

describe('click_element schema', () => {
  it('has ref as a top-level optional field', () => {
    const shape = (clickElement.inputSchema as any);
    expect(shape).toHaveProperty('ref');
    expect(shape).toHaveProperty('selector');
    expect(shape).toHaveProperty('text');
  });
});

describe('press_key schema', () => {
  it('requires `key` and accepts optional ref/selector/tab_id', () => {
    const shape = (pressKey.inputSchema as any);
    expect(shape).toHaveProperty('key');
    expect(shape).toHaveProperty('ref');
    expect(shape).toHaveProperty('selector');
    expect(shape).toHaveProperty('tab_id');
  });

  it('description mentions form submission and dialog dismissal', () => {
    const desc = pressKey.description.toLowerCase();
    expect(desc).toMatch(/enter|submit/);
    expect(desc).toMatch(/escape|dismiss|dialog/);
  });
});
