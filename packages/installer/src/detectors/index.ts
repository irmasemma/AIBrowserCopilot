import { register } from './registry.js';
import { claudeDesktopDetector } from './claude-desktop.js';
import { claudeCodeDetector } from './claude-code.js';
import { vscodeDetector } from './vscode.js';
import { cursorDetector } from './cursor.js';

export const registerAllDetectors = (): void => {
  register(claudeDesktopDetector);
  register(claudeCodeDetector);
  register(vscodeDetector);
  register(cursorDetector);
};

export { claudeDesktopDetector } from './claude-desktop.js';
export { claudeCodeDetector } from './claude-code.js';
export { vscodeDetector } from './vscode.js';
export { cursorDetector } from './cursor.js';
export { getAll, runAll, clear } from './registry.js';
export type { ToolDetector, DetectionResult, WriteConfigResult, ToolDetectionSummary } from './types.js';
