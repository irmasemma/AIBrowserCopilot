import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync } from 'node:fs';

export interface IndentStyle {
  type: 'space' | 'tab';
  amount: number;
}

export interface MergeResult {
  success: boolean;
  backupPath?: string;
  action: 'created' | 'merged' | 'skipped';
  error?: string;
}

/**
 * Create a timestamped backup of a config file.
 * Returns the backup file path.
 */
export const createBackup = (filePath: string): string => {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const backupPath = `${filePath}.backup-${timestamp}`;
  copyFileSync(filePath, backupPath);
  return backupPath;
};

/**
 * Detect the indentation style used in a JSON string.
 * Returns the indent type and amount. Defaults to 2 spaces.
 */
export const detectIndent = (content: string): IndentStyle => {
  const lines = content.split('\n');

  for (const line of lines) {
    // Find first line that starts with whitespace (indented line)
    const match = line.match(/^(\s+)/);
    if (match) {
      const indent = match[1];
      if (indent.includes('\t')) {
        return { type: 'tab', amount: 1 };
      }
      return { type: 'space', amount: indent.length };
    }
  }

  // Default to 2 spaces
  return { type: 'space', amount: 2 };
};

/**
 * Deep merge source into target without clobbering sibling keys.
 * Source values take priority for leaf conflicts.
 */
export const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      isPlainObject(targetVal) &&
      isPlainObject(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
};

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null && !Array.isArray(val);

/**
 * Merge new config entries into an existing config file.
 * - Creates backup of existing file
 * - Detects and preserves indentation style
 * - Preserves trailing newline
 * - Writes atomically via temp file + rename
 * - Verifies written JSON is valid
 *
 * If filePath doesn't exist, creates a new file (no backup needed).
 * If content is malformed JSON, throws without writing.
 */
export const mergeConfig = (
  filePath: string,
  newEntries: Record<string, unknown>,
): MergeResult => {
  const fileExists = existsSync(filePath);

  if (fileExists) {
    // Read existing content
    const raw = readFileSync(filePath, 'utf-8');

    // Validate existing JSON before touching anything
    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(raw);
    } catch {
      return {
        success: false,
        action: 'skipped',
        error: `Config file contains malformed JSON: ${filePath}`,
      };
    }

    // Detect indent style and trailing newline
    const indent = detectIndent(raw);
    const hasTrailingNewline = raw.endsWith('\n');

    // Create backup
    const backupPath = createBackup(filePath);

    // Deep merge
    const merged = deepMerge(existing, newEntries);

    // Serialize with preserved formatting
    const indentStr = indent.type === 'tab' ? '\t' : ' '.repeat(indent.amount);
    let output = JSON.stringify(merged, null, indentStr);
    if (hasTrailingNewline) {
      output += '\n';
    }

    // Atomic write: temp file + rename
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, output, 'utf-8');
    renameSync(tempPath, filePath);

    // Verify
    verifyWrite(filePath);

    return { success: true, backupPath, action: 'merged' };
  } else {
    // Create new file
    const output = JSON.stringify(newEntries, null, 2) + '\n';

    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, output, 'utf-8');
    renameSync(tempPath, filePath);

    verifyWrite(filePath);

    return { success: true, action: 'created' };
  }
};

/**
 * Re-read a file and parse it as JSON to verify it's valid.
 * Throws if the file is not valid JSON.
 */
export const verifyWrite = (filePath: string): void => {
  const content = readFileSync(filePath, 'utf-8');
  JSON.parse(content);
};
