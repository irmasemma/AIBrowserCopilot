import type { PlatformInfo } from '../shared/platform.js';
import type { MergeResult } from '../installers/config-merger.js';

export interface DetectionResult {
  installed: boolean;
  version?: string;
  configPath?: string;
  configExists?: boolean;
  hasExistingMcp?: boolean;
}

export interface WriteConfigResult extends MergeResult {}

export interface ToolDetector {
  /** Human-readable name, e.g. "Claude Desktop" */
  name: string;
  /** URL-safe identifier, e.g. "claude-desktop" */
  slug: string;
  /** Detect whether the tool is installed */
  detect(platform: PlatformInfo): Promise<DetectionResult>;
  /** Write MCP config for this tool */
  writeConfig(platform: PlatformInfo, binaryPath: string, extensionId?: string): Promise<WriteConfigResult>;
  /** Verify the config was written correctly */
  verifyConfig(platform: PlatformInfo): Promise<boolean>;
}

export interface ToolDetectionSummary {
  detector: ToolDetector;
  detection: DetectionResult;
  error?: string;
}
