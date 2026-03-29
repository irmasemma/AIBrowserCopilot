export interface ToolDefinition {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  tier: 'free' | 'pro';
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'get_page_content', displayName: 'Page Content', description: 'Read text from any page', icon: '📄', tier: 'free' },
  { name: 'take_screenshot', displayName: 'Screenshot', description: 'Capture what you see', icon: '📸', tier: 'free' },
  { name: 'list_tabs', displayName: 'List Tabs', description: 'See all open tabs', icon: '📋', tier: 'free' },
  { name: 'get_page_metadata', displayName: 'Metadata', description: 'Read page title, description, OG tags', icon: '🔗', tier: 'pro' },
  { name: 'navigate', displayName: 'Navigate', description: 'Go to any URL', icon: '🧭', tier: 'pro' },
  { name: 'fill_form', displayName: 'Fill Form', description: 'Auto-fill form fields', icon: '✏️', tier: 'pro' },
  { name: 'click_element', displayName: 'Click', description: 'Click buttons and links', icon: '👆', tier: 'pro' },
  { name: 'extract_table', displayName: 'Extract Table', description: 'Get table data as structured data', icon: '📊', tier: 'pro' },
];
