import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServiceDiscovery } from './service-discovery.js';

describe('service-discovery', () => {
  let sendNativeMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendNativeMessageMock = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        sendNativeMessage: sendNativeMessageMock,
        lastError: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('discoverEndpoint', () => {
    it('returns URL from lock file when NM helper responds', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          callback({ exists: true, port: 8080, token: 'abc123' });
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toBe('ws://127.0.0.1:8080?token=abc123');
      expect(result.token).toBe('abc123');
    });

    it('returns URL without token when lock file has no token', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          callback({ exists: true, port: 9000 });
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toBe('ws://127.0.0.1:9000');
      expect(result.token).toBeUndefined();
    });

    it('falls back to default URL when NM helper fails', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          // Simulate chrome.runtime.lastError
          (chrome.runtime as { lastError: { message: string } | null }).lastError = { message: 'Native host not found' };
          callback(undefined);
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toBe('ws://127.0.0.1:7483');
      expect(result.token).toBeUndefined();
    });

    it('falls back to default URL when lock file does not exist', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          callback({ exists: false });
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toBe('ws://127.0.0.1:7483');
    });

    it('falls back to default URL when chrome API is not available', async () => {
      vi.stubGlobal('chrome', undefined);

      const sd = createServiceDiscovery();
      const result = await sd.discoverEndpoint();

      expect(result.url).toBe('ws://127.0.0.1:7483');
    });
  });

  describe('scanTools', () => {
    it('returns tool results from NM helper', async () => {
      const mockTools = [
        { tool: 'Claude Desktop', slug: 'claude-desktop', installed: true, configured: true, configPath: '/path' },
        { tool: 'VS Code', slug: 'vscode', installed: true, configured: false, configPath: '/path2' },
      ];

      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          callback({ tools: mockTools });
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.scanTools();

      expect(result).toEqual(mockTools);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when NM helper fails', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          (chrome.runtime as { lastError: { message: string } | null }).lastError = { message: 'Not found' };
          callback(undefined);
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.scanTools();

      expect(result).toEqual([]);
    });

    it('returns empty array when response has no tools property', async () => {
      sendNativeMessageMock.mockImplementation(
        (_host: string, _msg: unknown, callback: (response: unknown) => void) => {
          callback({ error: 'something went wrong' });
        },
      );

      const sd = createServiceDiscovery();
      const result = await sd.scanTools();

      expect(result).toEqual([]);
    });

    it('returns empty array when chrome API is not available', async () => {
      vi.stubGlobal('chrome', undefined);

      const sd = createServiceDiscovery();
      const result = await sd.scanTools();

      expect(result).toEqual([]);
    });
  });
});
