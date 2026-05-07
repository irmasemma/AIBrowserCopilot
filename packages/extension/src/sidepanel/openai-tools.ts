// OpenAI function-calling schemas for every tool the in-extension chat agent can call.
// Mirrors the Zod schemas in `packages/native-host/src/tools/*.ts` — kept hand-written
// rather than imported because the extension and native-host don't share a build.

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export const OPENAI_TOOLS: OpenAIFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_page_content',
      description: 'Read the visible text (or HTML) of the page the user is currently viewing in their browser. Use this to understand what is on the screen.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['text', 'html'], description: 'Output format. Default: text.' },
          tab_id: { type: 'number', description: 'Specific tab id to read (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture a screenshot of the current tab. Use to visually inspect the page.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format. Default: png.' },
          quality: { type: 'number', description: 'JPEG quality 0-100. Default: 80.' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: "List all of the user's open browser tabs with titles and URLs. Use to find a tab by name before switching to it.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional substring to filter tabs by title or URL.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_metadata',
      description: 'Return title, URL, description, Open Graph tags, and favicon for the current page. Cheaper than reading full content when you only need a summary.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: "Send the user's browser tab to a URL. Use this to open a website.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL to navigate to (must include scheme).' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: 'Fill one or more form fields on the current page. PREFER calling `snapshot` first and using the [ref=eN] IDs in the field `ref` parameter — refs are unambiguous and cross iframes. Other locators (label, role+name, placeholder, selector) are accepted as fallbacks. Element type is auto-detected from the DOM; you only need `type` to override detection. Use `checked: true|false` for checkboxes, `values: [...]` for multi-select.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            description: 'Fields to fill. Each field needs a locator (ref preferred, else label/role+name/placeholder/selector) plus value/values/checked.',
            items: {
              type: 'object',
              properties: {
                ref: { type: 'string', description: 'PREFERRED locator: ref ID from snapshot (e.g., "e3").' },
                selector: { type: 'string', description: 'CSS selector.' },
                label: { type: 'string', description: 'Visible label text.' },
                role: { type: 'string', description: 'ARIA role. MUST be paired with `name` (role-only is rejected).' },
                name: { type: 'string', description: 'Accessible name to combine with `role` (e.g., role: "textbox", name: "Email").' },
                placeholder: { type: 'string', description: 'Placeholder text.' },
                value: { type: 'string', description: 'Value to fill in. For text inputs, single-select, file paths.' },
                values: { type: 'array', items: { type: 'string' }, description: 'For multi-select: list of options. For file inputs: list of paths.' },
                checked: { type: 'boolean', description: 'For checkboxes/switches: explicit checked state.' },
                type: { type: 'string', enum: ['text', 'select', 'checkbox', 'radio', 'file', 'date'], description: 'Override type detection. Usually unnecessary.' },
              },
            },
          },
          iframe: { type: 'string', description: 'CSS selector for an iframe (used only with non-ref locators; refs cross iframes automatically).' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Click a button, link, or any clickable element on the current page. PREFER `ref` from the page snapshot for unambiguous targeting. Falls back to text or CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'PREFERRED: ref ID from snapshot (e.g., "e7").' },
          selector: { type: 'string', description: 'CSS selector for the element to click.' },
          text: { type: 'string', description: 'Visible text of the element. Prefers buttons/links.' },
          index: { type: 'number', description: 'Which match to click when multiple match (0 = first).' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key, optionally focused on a specific element. Use to submit forms (key="Enter" with the last input\'s ref), dismiss dialogs (key="Escape"), or navigate (key="Tab", "ArrowDown"). Omit ref/selector to send the key at the page level.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name: "Enter", "Escape", "Tab", "Backspace", "ArrowDown", "PageDown", "Control+a", etc.' },
          ref: { type: 'string', description: 'PREFERRED: ref ID of element to focus before pressing.' },
          selector: { type: 'string', description: 'CSS selector of element to focus before pressing.' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_table',
      description: 'Extract a classic HTML <table> from the current page as headers + rows.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for a specific table.' },
          index: { type: 'number', description: 'Which table to extract when multiple exist (0 = first).' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_form',
      description: 'List every form field on the current page with labels, types, and current values. Use this before fill_form to learn what selectors to target.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for a specific form (defaults to all forms).' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_data',
      description: 'Heuristically detect and extract structured data on the page — card grids, product listings, search results, posts, classic tables, etc. Returns the strongest data region as headers + rows.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional container selector.' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Optional column-name hints.' },
          format: { type: 'string', enum: ['table', 'json'], description: 'Output format. Default: table.' },
          max_rows: { type: 'number', description: 'Maximum rows to extract. Default: 100.' },
          include_links: { type: 'boolean', description: 'Include href URLs.' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll_page',
      description: 'Scroll the current page in a direction, to a CSS selector, or to specific text. Use to reveal content below the fold or trigger infinite-scroll loading.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction.' },
          amount: { type: 'number', description: 'Pixels to scroll (overrides direction default).' },
          selector: { type: 'string', description: 'Scroll this element into view.' },
          text: { type: 'string', description: 'Find this text and scroll to it.' },
          wait_for_content: { type: 'boolean', description: 'Wait for lazy content to settle. Default: true.' },
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'go_back',
      description: 'Navigate the current tab back in browser history.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'go_forward',
      description: 'Navigate the current tab forward in browser history.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'number', description: 'Specific tab id (defaults to active tab).' },
        },
      },
    },
  },
];

export const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(OPENAI_TOOLS.map(t => t.function.name));

export const filterEnabledTools = (
  permissions: Record<string, boolean>,
): OpenAIFunctionTool[] =>
  // A tool is enabled if its permission is true OR not yet recorded (default-on for tools
  // that aren't surfaced in the permission UI, like scroll_page/go_back/go_forward).
  OPENAI_TOOLS.filter(t => permissions[t.function.name] !== false);
