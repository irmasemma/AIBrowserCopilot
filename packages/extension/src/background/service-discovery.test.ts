import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServiceDiscovery } from './service-discovery.js';

describe('service-discovery', () => {
  describe('discoverEndpoint', () => {
    it('returns hardcoded URL with browserId', async () => {
      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toMatch(/^ws:\/\/127\.0\.0\.1:7483\?browserId=/);
      expect(result.diagnostic).toBe('connecting');
    });
  });
});
