import { register } from './registry.js';
import { claudeDesktopDetector } from './claude-desktop.js';
import { claudeCodeDetector } from './claude-code.js';
import { vscodeDetector } from './vscode.js';
import { cursorDetector } from './cursor.js';
import { windsurfDetector } from './windsurf.js';
import { jetbrainsDetector } from './jetbrains.js';
import { zedDetector } from './zed.js';
import { continueDevDetector } from './continue-dev.js';

export const registerAllDetectors = (): void => {
  register(claudeDesktopDetector);
  register(claudeCodeDetector);
  register(vscodeDetector);
  register(cursorDetector);
  register(windsurfDetector);
  register(jetbrainsDetector);
  register(zedDetector);
  register(continueDevDetector);
};

export { claudeDesktopDetector } from './claude-desktop.js';
export { claudeCodeDetector } from './claude-code.js';
export { vscodeDetector } from './vscode.js';
export { cursorDetector } from './cursor.js';
export { windsurfDetector } from './windsurf.js';
export { jetbrainsDetector } from './jetbrains.js';
export { zedDetector } from './zed.js';
export { continueDevDetector } from './continue-dev.js';
export { getAll, runAll, clear } from './registry.js';
export type { ToolDetector, DetectionResult, WriteConfigResult, ToolDetectionSummary } from './types.js';
