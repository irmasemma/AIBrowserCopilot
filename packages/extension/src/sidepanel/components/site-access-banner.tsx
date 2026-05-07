import type { FunctionalComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/**
 * Banner shown when the extension lacks <all_urls> host access.
 *
 * Detection sources (in priority order):
 *   1. chrome.permissions.contains({ origins: ['<all_urls>'] }) — primary,
 *      reliable because <all_urls> is declared as an OPTIONAL host
 *      permission. The browser fires permissions.onAdded/onRemoved when
 *      the user changes it.
 *   2. chrome.storage.local.siteAccessBlocked — a fallback flag written
 *      by the background tool dispatcher when an MCP tool call hits the
 *      Edge "Site access: On click" runtime override (which does NOT
 *      change permissions.contains in some Edge builds). The flag is
 *      cleared once the user grants access via the button below.
 *
 * The grant button calls chrome.permissions.request({ origins: ['<all_urls>'] })
 * which shows the native prompt; clicking Allow flips both signals.
 */
export const SiteAccessBanner: FunctionalComponent = () => {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [runtimeBlocked, setRuntimeBlocked] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAccess = async (): Promise<void> => {
    try {
      const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      setHasAccess(granted);
      if (granted) {
        // Permission is granted — clear any stale runtime flag so the
        // banner doesn't keep flickering back from a previously-failed
        // tool call.
        await chrome.storage.local.remove('siteAccessBlocked').catch(() => undefined);
        setRuntimeBlocked(false);
      }
    } catch {
      setHasAccess(true);
    }
  };

  const checkRuntimeFlag = async (): Promise<void> => {
    try {
      const { siteAccessBlocked } = await chrome.storage.local.get('siteAccessBlocked');
      setRuntimeBlocked(Boolean(siteAccessBlocked));
    } catch {
      setRuntimeBlocked(false);
    }
  };

  useEffect(() => {
    void checkAccess();
    void checkRuntimeFlag();
    const onPermChange = () => { void checkAccess(); };
    chrome.permissions.onAdded?.addListener(onPermChange);
    chrome.permissions.onRemoved?.addListener(onPermChange);

    const onStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && 'siteAccessBlocked' in changes) {
        setRuntimeBlocked(Boolean(changes.siteAccessBlocked.newValue));
      }
    };
    chrome.storage.onChanged.addListener(onStorageChange);

    return () => {
      chrome.permissions.onAdded?.removeListener(onPermChange);
      chrome.permissions.onRemoved?.removeListener(onPermChange);
      chrome.storage.onChanged.removeListener(onStorageChange);
    };
  }, []);

  const handleGrant = async () => {
    setRequesting(true);
    setError(null);
    try {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (granted) {
        setHasAccess(true);
        setRuntimeBlocked(false);
        await chrome.storage.local.remove('siteAccessBlocked').catch(() => undefined);
      } else {
        setError(
          'Permission was not granted. You can also enable it manually at ' +
          'edge://extensions → Details on AI Browser CoPilot → Site access → "On all sites".',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  };

  // Show banner only when EITHER signal indicates blocked access AND we've
  // resolved the initial permission state (don't flash on first paint).
  const shouldShow = hasAccess === false || runtimeBlocked;
  if (!shouldShow) return null;

  return (
    <div
      class="mx-3 my-2 p-3 rounded border border-amber-300 bg-amber-50"
      role="alert"
      aria-label="Grant site access to enable browser tools"
      data-testid="site-access-banner"
    >
      <div class="flex items-start gap-2 mb-2">
        <span class="text-amber-600 text-base leading-none mt-0.5" aria-hidden="true">
          {'\u26A0\uFE0F'}
        </span>
        <div class="flex-1">
          <p class="text-sm font-medium text-amber-900">Browser is blocking site access</p>
          <p class="text-xs text-amber-800 mt-0.5">
            Tools like <code class="font-mono">get_page_content</code> and{' '}
            <code class="font-mono">click_element</code> need access to the pages you visit.
            Sideloaded extensions start with this access revoked.
          </p>
        </div>
      </div>
      <button
        class="w-full text-sm font-medium text-white bg-amber-600 py-1.5 rounded hover:bg-amber-700 disabled:opacity-50"
        onClick={handleGrant}
        disabled={requesting}
        data-testid="site-access-banner-grant"
      >
        {requesting ? 'Requesting…' : 'Grant access to all sites'}
      </button>
      {error && (
        <p class="text-xs text-amber-700 mt-2" data-testid="site-access-banner-error">
          {error}
        </p>
      )}
    </div>
  );
};
