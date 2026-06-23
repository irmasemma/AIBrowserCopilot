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

// ─────────────────────────────────────────────────────────────────────────
// Tab-id schema invariants. Locks the schemas to the truth so a future
// hand-edit can't reintroduce the "tab_id defaults to active tab" lie
// that caused docs/session-2026-06-04-postdownloader-overhaul.md §21.
// ─────────────────────────────────────────────────────────────────────────

describe('tab_id schema invariants across the tool registry', () => {
  const tabTargetingTools = () => toolRegistry.filter(t => t.name !== 'list_tabs');

  it('no tab_id field description mentions the long-removed "active tab" default', () => {
    // The active-tab fallback was removed in commit 4ee5e28. Any tool that
    // still claims it defaults to the active tab is lying — that lie is
    // what caused external MCP clients to omit tab_id and see empty results.
    for (const tool of tabTargetingTools()) {
      const tabIdField = tool.inputSchema.tab_id as any;
      const desc = tabIdField?._def?.description ?? '';
      expect(
        desc.toLowerCase(),
        `${tool.name}.tab_id description still mentions "active tab"`,
      ).not.toContain('active tab');
    }
  });

  it('tab_id is a required ZodString on every tab-targeting tool (not optional, not number)', () => {
    for (const tool of tabTargetingTools()) {
      const tabIdField = tool.inputSchema.tab_id as any;
      expect(tabIdField, `${tool.name} must have a tab_id field`).toBeDefined();
      const typeName = tabIdField?._def?.typeName;
      // Must NOT be optional (was z.number().optional() — the bug)
      expect(typeName, `${tool.name}.tab_id must not be ZodOptional`).not.toBe('ZodOptional');
      // Must be a string (namespaced ids from list_tabs are strings, e.g. "chrome:abc:622")
      expect(typeName, `${tool.name}.tab_id should be ZodString`).toBe('ZodString');
    }
  });

  it('tab_id description points users at list_tabs (so the agent knows how to recover)', () => {
    for (const tool of tabTargetingTools()) {
      const tabIdField = tool.inputSchema.tab_id as any;
      const desc = tabIdField?._def?.description ?? '';
      expect(
        desc.toLowerCase(),
        `${tool.name}.tab_id description should mention list_tabs`,
      ).toContain('list_tabs');
    }
  });
});
