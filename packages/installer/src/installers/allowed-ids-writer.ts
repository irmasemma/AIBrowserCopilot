/**
 * Writes the `extension-ids.json` config file the native-host bridge reads
 * at startup to populate its Origin allowlist. Without this file (and
 * without the `AGENTHUB_ALLOWED_EXTENSION_IDS` env var) the bridge falls
 * back to accepting any chrome-extension:// origin — defense in depth that
 * keeps the door open for any co-installed extension to talk to us.
 *
 * Activated automatically when the installer is invoked with
 * `--extension-id <id>`. Subsequent installs with a new ID overwrite the
 * file rather than appending, so a user re-installing with a fresh dev ID
 * gets the new ID and nothing else.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WriteAllowedIdsResult {
  ok: boolean;
  path: string;
  error?: string;
}

export const ALLOWED_IDS_FILENAME = 'extension-ids.json';

export function writeAllowedExtensionIds(
  configPath: string,
  ids: ReadonlyArray<string>,
): WriteAllowedIdsResult {
  try {
    const cleaned = Array.from(new Set(
      ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => id.length > 0),
    ));
    if (cleaned.length === 0) {
      return { ok: false, path: configPath, error: 'No valid extension IDs provided' };
    }
    const dir = dirname(configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf-8');
    return { ok: true, path: configPath };
  } catch (err) {
    return {
      ok: false,
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
