import type { ToolPlugin } from '../shared/types.js';
import { getPageContent } from './get-page-content.js';
import { getPageMetadata } from './get-page-metadata.js';
import { takeScreenshot } from './take-screenshot.js';
import { listTabs } from './list-tabs.js';
import { navigate } from './navigate.js';
import { fillForm } from './fill-form.js';
import { clickElement } from './click-element.js';
import { extractTable } from './extract-table.js';

export const toolRegistry: ToolPlugin[] = [
  getPageContent,
  getPageMetadata,
  takeScreenshot,
  listTabs,
  navigate,
  fillForm,
  clickElement,
  extractTable,
];
