/**
 * Bridge (native-host) version compatibility check.
 *
 * The extension and the native host are released as a pair. When the extension
 * is updated to require new bridge functionality, this constant is bumped and
 * the extension UI prompts users to re-run the installer.
 */
export const MIN_NATIVE_HOST_VERSION = '0.3.0';

/** Compare two semver-like dotted version strings. -1, 0, or 1. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
};

export type VersionStatus = 'ok' | 'outdated';

/**
 * Compare the running native-host version to the minimum the extension was
 * built against. Returns 'outdated' when the user needs to re-run the
 * installer, 'ok' otherwise.
 *
 * `null`/`undefined`/empty `installed` is treated as 'outdated' — a server
 * that doesn't report a version is too old to be trusted.
 */
export const checkBridgeVersion = (
  installed: string | null | undefined,
  minimum: string = MIN_NATIVE_HOST_VERSION,
): VersionStatus => {
  if (!installed || typeof installed !== 'string') return 'outdated';
  return compareVersions(installed, minimum) < 0 ? 'outdated' : 'ok';
};
