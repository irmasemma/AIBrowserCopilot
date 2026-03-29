import { useState, useEffect } from 'preact/hooks';

interface LicenseState {
  hasLicense: boolean;
  loading: boolean;
  expiresAt: number | null;
}

const GRACE_PERIOD_MS = 72 * 60 * 60 * 1000; // 72 hours

export const useLicense = (): LicenseState => {
  const [state, setState] = useState<LicenseState>({
    hasLicense: false,
    loading: true,
    expiresAt: null,
  });

  useEffect(() => {
    const checkLicense = async () => {
      const data = await chrome.storage.local.get('licenseCache');
      const cache = data.licenseCache as { valid: boolean; checkedAt: number; expiresAt: number | null } | undefined;

      if (cache) {
        const withinGracePeriod = Date.now() - cache.checkedAt < GRACE_PERIOD_MS;
        setState({
          hasLicense: cache.valid && (withinGracePeriod || cache.expiresAt === null || cache.expiresAt > Date.now()),
          loading: false,
          expiresAt: cache.expiresAt,
        });
      } else {
        setState({ hasLicense: false, loading: false, expiresAt: null });
      }
    };

    checkLicense();

    // Re-check when storage changes (payment callback updates cache)
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.licenseCache) {
        checkLicense();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return state;
};

// Call this after payment completes (from payment provider callback)
export const updateLicenseCache = async (valid: boolean, expiresAt: number | null = null): Promise<void> => {
  await chrome.storage.local.set({
    licenseCache: { valid, checkedAt: Date.now(), expiresAt },
  });
};
