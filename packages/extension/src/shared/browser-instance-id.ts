/**
 * Profile-unique browser instance ID.
 *
 * The bridge keys connected extensions in a Map<string, WebSocket>. If every
 * Chrome profile registered as just "chrome", the second profile to connect
 * would evict the first (the Map.set semantics overwrite). Result: only one
 * Chrome profile's tabs would ever be reachable.
 *
 * To support multi-profile fan-out, each install generates a stable UUID once
 * and stores it in chrome.storage.local. The composite ID is `${brand}:${uuid}`,
 * which is unique per (browser brand, profile) pair and persists across
 * extension restarts.
 *
 * See docs/multi-profile-tab-fanout-design.md.
 */

const STORAGE_KEY = 'browserInstanceUuid';

function detectBrand(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Brave')) return 'brave';
  if (ua.includes('Vivaldi')) return 'vivaldi';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'opera';
  if (ua.includes('Arc')) return 'arc';
  if (ua.includes('Chrome/')) return 'chrome';
  return 'unknown';
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older Chrome).
  // Format: 8-4-4-4-12 hex chars. Not cryptographically perfect but unique
  // enough for routing identifiers.
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
}

let cachedId: string | null = null;

/**
 * Returns the composite browser instance id (`${brand}:${uuid}`).
 * Generates and persists the UUID on first call. Subsequent calls return
 * the cached value (in-process) or read from storage.
 *
 * Returns brand-only when chrome.storage is unavailable (e.g., test
 * environments). Callers should treat both forms as opaque.
 */
export async function getBrowserInstanceId(): Promise<string> {
  if (cachedId !== null) return cachedId;

  const brand = detectBrand();

  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    cachedId = brand;
    return cachedId;
  }

  const stored = await new Promise<{ [k: string]: unknown }>((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (data) => resolve(data ?? {}));
  });

  let uuid = typeof stored[STORAGE_KEY] === 'string' ? (stored[STORAGE_KEY] as string) : '';
  if (!uuid) {
    uuid = generateUuid();
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: uuid }, () => resolve());
    });
  }

  cachedId = `${brand}:${uuid}`;
  return cachedId;
}

/** Test-only: clear the in-process cache. */
export function __resetCacheForTesting(): void {
  cachedId = null;
}
