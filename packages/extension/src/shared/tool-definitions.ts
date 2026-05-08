export interface ToolDefinition {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  /**
   * Tier was used to gate Pro tools behind a license. The license model has
   * been retired — every MCP tool is free. The field is preserved so existing
   * callers don't break, but every tool is 'free'.
   */
  tier: 'free';
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'get_page_content', displayName: 'Page Content', description: 'Read text from any page', icon: '📄', tier: 'free' },
  { name: 'take_screenshot', displayName: 'Screenshot', description: 'Capture what you see', icon: '📸', tier: 'free' },
  { name: 'list_tabs', displayName: 'List Tabs', description: 'See all open tabs', icon: '📋', tier: 'free' },
  { name: 'get_page_metadata', displayName: 'Metadata', description: 'Read page title, description, OG tags', icon: '🔗', tier: 'free' },
  { name: 'navigate', displayName: 'Navigate', description: 'Go to any URL', icon: '🧭', tier: 'free' },
  { name: 'fill_form', displayName: 'Fill Form', description: 'Auto-fill form fields', icon: '✏️', tier: 'free' },
  { name: 'click_element', displayName: 'Click', description: 'Click buttons and links', icon: '👆', tier: 'free' },
  { name: 'press_key', displayName: 'Press Key', description: 'Submit forms or press keyboard keys', icon: '⌨️', tier: 'free' },
  { name: 'extract_table', displayName: 'Extract Table', description: 'Get table data as structured data', icon: '📊', tier: 'free' },
  { name: 'read_form', displayName: 'Read Form', description: 'Read all form fields and their metadata', icon: '📝', tier: 'free' },
  { name: 'extract_data', displayName: 'Extract Data', description: 'Detect and extract structured data from any page', icon: '🔍', tier: 'free' },
];
