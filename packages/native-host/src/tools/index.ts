import type { ToolPlugin } from '../shared/types.js';
import { getPageContent } from './get-page-content.js';
import { getPageMetadata } from './get-page-metadata.js';
import { takeScreenshot } from './take-screenshot.js';
import { listTabs } from './list-tabs.js';
import { navigate } from './navigate.js';
import { fillForm } from './fill-form.js';
import { clickElement } from './click-element.js';
import { pressKey } from './press-key.js';
import { extractTable } from './extract-table.js';
import { readForm } from './read-form.js';
import { extractData } from './extract-data.js';
import { scrollPage } from './scroll-page.js';
import { goBack } from './go-back.js';
import { goForward } from './go-forward.js';
import { snapshot } from './snapshot.js';

export const toolRegistry: ToolPlugin[] = [
  getPageContent,
  getPageMetadata,
  takeScreenshot,
  snapshot,
  listTabs,
  navigate,
  fillForm,
  clickElement,
  pressKey,
  extractTable,
  readForm,
  extractData,
  scrollPage,
  goBack,
  goForward,
];
