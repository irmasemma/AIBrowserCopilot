# Form Stress Test — Adversarial Agent Prompt

## Context

You are testing **AgentHub**, a Chrome extension that reads and fills web forms via MCP tools: `read_form` and `fill_form`. The extension claims to handle modern web forms across frameworks.

Your job is to **break it**. Not to confirm it works — to find where it fails.

---

## Agent 1: THE FORM ARCHITECT (Skeptic Builder)

**Role:** You build the hardest, most realistic forms that modern web apps actually use. You are not here to create toy examples. You are here to create forms that represent what users encounter on real sites — and the ugly edge cases developers ship.

**Output:** For each form, produce a single self-contained HTML file that can be opened in Chrome. Include all framework code via CDN. Each file must be runnable with zero build step.

### Round 1 — Baseline (should work, but verify)

Build these as separate HTML files:

1. **Plain HTML form** — text, email, password, textarea, select (single + multi), radio group, checkbox group, date, time, number with min/max, range slider, color picker, file upload, hidden fields. Include `required` attributes and a `disabled` field.

2. **React 18 controlled form** (via CDN/Babel standalone) — same field types as above but all controlled components with `useState`. Add an `onChange` handler that uppercases text input. Include a field that only appears after selecting a specific radio option (conditional rendering).

3. **Vue 3 reactive form** (via CDN) — same coverage. Use `v-model` bindings. Add a computed field that shows character count. Include a `v-if` field that appears only when a checkbox is checked.

### Round 2 — Real-World Complexity (where things get interesting)

4. **Multi-step wizard form** — 3 steps with Next/Back buttons. Fields from step 1 must persist when navigating. Step 3 has a summary showing all entered data. Use vanilla JS. The "Next" button should be disabled until required fields are filled.

5. **Dynamic repeatable fields** — "Add another phone number" pattern. Each added row has: type dropdown (mobile/home/work), phone input with mask, and a remove button. Start with 1 row, allow up to 5. Use vanilla JS.

6. **Inline edit table** — A data table where clicking a cell turns it into an editable input. Has "Save row" and "Cancel" buttons per row. Mix of text, select, and checkbox cells. Use contenteditable for some cells and actual inputs for others.

7. **Autocomplete/typeahead search** — An input that shows a dropdown of filtered results as you type. Selecting a result populates multiple fields (city, state, zip). Uses `fetch` against a mock data array. The dropdown must be navigable with arrow keys.

### Round 3 — Framework Components & Shadow DOM

8. **Web Components with Shadow DOM** — Build 3 custom elements: `<custom-input>`, `<custom-select>`, `<custom-checkbox>`. Each uses Shadow DOM with internal `<input>`/`<select>`. Compose them into a form. The form's submit handler reads values from the shadow roots.

9. **Lit Element form** (via CDN) — A form built entirely with Lit web components. Include reactive properties, custom validation, and slotted label content.

10. **ARIA-heavy accessible form** — No native `<select>` elements. Instead: custom ARIA combobox (role="combobox" + role="listbox"), ARIA radio group (role="radiogroup" + role="radio"), ARIA switch, ARIA slider. All keyboard-navigable. This is how Radix UI, Headless UI, and Reach UI actually work.

### Round 4 — Hostile Edge Cases

11. **Form inside iframes** — A page with 3 iframes: same-origin iframe with a form, srcdoc iframe with a form, and a sandboxed iframe with a form. Each has different field types.

12. **CSS-hidden but DOM-present fields** — Fields hidden with `display:none`, `visibility:hidden`, `opacity:0`, `clip-path`, `position:absolute;left:-9999px`, and `aria-hidden="true"`. Some are honeypot fields (should NOT be filled). Some are real fields revealed by JS interaction.

13. **Rapid DOM mutation form** — A form where fields are added/removed/reordered by a `setInterval` every 500ms. Labels change. IDs rotate. Selectors that worked 1 second ago are stale. This simulates aggressive SPA re-rendering.

14. **Conflicting selectors** — Multiple forms on one page. Fields with duplicate `name` attributes across forms. Fields with identical placeholders. Fields with identical labels. Only `data-testid` attributes are unique. No IDs on anything.

15. **Third-party embedded form** — Simulate a Typeform/Google Form-style embed: a full-screen form inside an iframe where each question is shown one-at-a-time with animated transitions. Next question appears only after current is answered. Uses custom styled inputs (no native controls visible).

### Round 5 — Framework-Specific Traps

16. **React Hook Form + Zod validation** — Uncontrolled inputs with `register()`. Validation runs on blur AND submit. Error messages appear as ARIA live regions. Fields have `ref` forwarding. Include a field array (dynamic rows).

17. **Formik + Yup (React)** — Deeply nested field names (`address.shipping.street`). Field-level validation. `<FieldArray>` for repeating sections. `<FastField>` for optimized rendering (component doesn't re-render on every keystroke).

18. **Angular Reactive Forms** (via CDN if possible, otherwise standalone HTML that mimics the pattern) — `FormGroup` with `FormArray`. Custom validators. Async validators with debounce. `mat-select` style custom dropdowns.

19. **Svelte form** (via CDN compiler) — Two-way binding with `bind:value`. Reactive declarations. Transition-based conditional fields. Custom action directives on inputs.

20. **Contenteditable rich text** — A `contenteditable` div used as a form field (like Notion, Slack message input). Must handle: pasting HTML, maintaining cursor position, extracting clean text vs. HTML content. Include a toolbar that inserts formatting.

---

## Agent 2: THE FORM FILLER (Skeptic Tester)

**Role:** You use `read_form` and `fill_form` MCP tools to interact with each form Agent 1 created. You report exactly what worked, what failed, and what silently corrupted data.

**Methodology for EACH form:**

### Step 1: Read
- Call `read_form` (via `get_page_content` if read_form returns nothing useful)
- Record: How many fields detected? How many actually exist? Any missing? Any phantom fields?
- Grade: Detection rate = detected / actual real fields

### Step 2: Fill
- Attempt to fill ALL detected fields using `fill_form`
- Try multiple selector strategies per field: by selector, by label, by placeholder, by role
- Record: Which strategy worked? Which silently failed (no error but value not set)?
- After filling, call `get_page_content` to verify values actually persisted in the DOM

### Step 3: Verify
- Check that framework state updated (not just DOM). For React/Vue: did the component state change? Check by looking for rendered output that depends on the state (character counts, summaries, conditional fields).
- Check that validation triggered where expected
- Check that events fired (did onChange/onInput handlers run?)

### Step 4: Report (per form)

```
FORM: [name]
DETECTION: [X/Y fields found] — [list any missed fields and why]
FILL SUCCESS: [X/Y fields filled correctly]
SILENT FAILURES: [fields where fill_form returned success but value didn't stick]
FRAMEWORK STATE: [did React/Vue/etc. state actually update?]
SELECTOR RELIABILITY: [which strategies worked, which didn't]
VERDICT: PASS / PARTIAL / FAIL
NOTES: [anything surprising]
```

### Step 5: Summary Matrix

After all forms tested, produce:

| Form | Detection | Fill | State Sync | Verdict |
|------|-----------|------|------------|---------|
| ...  | X/Y       | X/Y  | Yes/No     | ...     |

### Critical Questions to Answer:

1. What % of modern form patterns can the extension actually handle end-to-end?
2. Where does `read_form` find fields but `fill_form` can't fill them?
3. Where does `fill_form` report success but the framework doesn't see the change?
4. Is Shadow DOM a total blind spot or partially handled?
5. How does the extension handle forms that don't use `<form>` elements at all?
6. What happens with dynamically added fields?
7. Can it handle ARIA widgets that replace native controls?

---

## Agent 3: THE AUDITOR (Optional — runs after Agent 2)

**Role:** Review Agent 2's test results. Challenge any "PASS" verdicts. For each PASS:
- Did Agent 2 actually verify framework state, or just DOM values?
- Did Agent 2 test with realistic data (not just "test123")?
- Did Agent 2 check what happens after form submission?
- Would a real user's workflow actually succeed end-to-end?

Downgrade any PASS that didn't meet all criteria to PARTIAL.

---

## Rules for All Agents

1. **No charity.** If something almost works, it failed. Users don't care about almost.
2. **No excuses.** "Shadow DOM is hard" is not a valid excuse. Competing tools handle it.
3. **Real data.** Use realistic form data: actual names, valid emails, real phone formats, plausible addresses. Not "asdf" and "test@test.com".
4. **Screenshot evidence.** Take screenshots before and after fill operations.
5. **Report silently wrong fills.** The most dangerous bug is `fill_form` returning success while the value didn't actually propagate to the framework's state.
