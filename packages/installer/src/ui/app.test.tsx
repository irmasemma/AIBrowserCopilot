import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import type { PlatformInfo } from '../shared/platform.js';
import type { CliFlags } from './app.js';
import type { DownloadProgress, InstallResult } from '../installers/binary-installer.js';
import type { RegistrationResult } from '../installers/host-registrar.js';

const defaultFlags: CliFlags = {
  yes: false,
  update: false,
  uninstall: false,
};

const noopDownload = async () => ({ success: true, binaryPath: 'test' });
const noopRegister = async () => ({ success: true, manifestPath: 'test' });
const noopHealthCheck = () => ({ healthy: true, binaryPath: 'test' });
const notInstalled = () => false;
const noopRunDetectors = async () => [] as any[];

const makePlatform = (overrides: Partial<PlatformInfo> = {}): PlatformInfo => ({
  os: 'windows',
  arch: 'x64',
  homeDir: 'C:\\Users\\test',
  isSupported: true,
  displayName: 'Windows x64',
  ...overrides,
});

const allMocks = {
  downloadFn: noopDownload,
  registerFn: noopRegister,
  checkHealthFn: noopHealthCheck,
  checkInstalledFn: notInstalled,
  runDetectorsFn: noopRunDetectors,
};

describe('App', () => {
  it('renders header with title', () => {
    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} />,
    );
    expect(lastFrame()).toContain('AI Browser CoPilot');
    expect(lastFrame()).toContain('Setup');
  });

  it('displays Windows x64 platform', () => {
    const { lastFrame } = render(
      <App platform={makePlatform({ displayName: 'Windows x64' })} flags={defaultFlags} {...allMocks} />,
    );
    expect(lastFrame()).toContain('Detecting your system...');
    expect(lastFrame()).toContain('Windows x64');
  });

  it('displays macOS arm64 platform', () => {
    const { lastFrame } = render(
      <App
        platform={makePlatform({ os: 'macos', arch: 'arm64', displayName: 'macOS arm64' })}
        flags={defaultFlags}
        {...allMocks}
      />,
    );
    expect(lastFrame()).toContain('macOS arm64');
  });

  it('displays Linux x64 platform', () => {
    const { lastFrame } = render(
      <App
        platform={makePlatform({ os: 'linux', arch: 'x64', displayName: 'Linux x64' })}
        flags={defaultFlags}
        {...allMocks}
      />,
    );
    expect(lastFrame()).toContain('Linux x64');
  });

  it('shows error for unsupported platform', () => {
    const { lastFrame } = render(
      <App
        platform={makePlatform({
          isSupported: false,
          displayName: 'freebsd x64 (unsupported)',
        })}
        flags={defaultFlags}
        {...allMocks}
      />,
    );
    expect(lastFrame()).toContain('not supported');
    expect(lastFrame()).toContain('freebsd x64 (unsupported)');
  });

  it('shows supported platforms list on unsupported error', () => {
    const { lastFrame } = render(
      <App
        platform={makePlatform({
          isSupported: false,
          displayName: 'freebsd x64 (unsupported)',
        })}
        flags={defaultFlags}
        {...allMocks}
      />,
    );
    expect(lastFrame()).toContain('Windows');
    expect(lastFrame()).toContain('macOS');
    expect(lastFrame()).toContain('Linux');
  });
});

describe('App - detection', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('shows not-found when binary does not exist', async () => {
    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} checkInstalledFn={() => false} />,
    );
    await delay(50);
    expect(lastFrame()).toContain('No existing installation');
  });

  it('shows found state when binary exists', async () => {
    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} checkInstalledFn={() => true} />,
    );
    await delay(50);
    expect(lastFrame()).toContain('already installed');
    expect(lastFrame()).toContain('[Y/n]');
  });

  it('auto-updates when --yes flag is set and binary exists', async () => {
    const mockDownload = vi.fn(async () => ({ success: true, binaryPath: 'test' }));
    const { lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={{ ...defaultFlags, yes: true }}
        {...allMocks}
        checkInstalledFn={() => true}
        downloadFn={mockDownload}
      />,
    );
    await delay(100);
    expect(mockDownload).toHaveBeenCalled();
  });

  it('skips download when user declines update', async () => {
    const mockDownload = vi.fn(async () => ({ success: true, binaryPath: 'test' }));
    const { stdin, lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={defaultFlags}
        {...allMocks}
        checkInstalledFn={() => true}
        downloadFn={mockDownload}
      />,
    );
    await delay(50);
    expect(lastFrame()).toContain('[Y/n]');

    stdin.write('n');
    await delay(100);
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

describe('App - download integration', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('starts downloading when no binary exists', async () => {
    const mockDownload = vi.fn(
      async (_p: any, _d: string, onProgress?: (p: DownloadProgress) => void) => {
        onProgress?.({ bytesReceived: 500, totalBytes: 1000, percent: 50 });
        return new Promise<InstallResult>(() => {}); // never resolves
      },
    );

    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} downloadFn={mockDownload} />,
    );

    await delay(100);
    expect(mockDownload).toHaveBeenCalled();
    expect(lastFrame()).toContain('Downloading');
    expect(lastFrame()).toContain('50%');
  });

  it('shows error state on download failure', async () => {
    const mockDownload = vi.fn(async () => ({
      success: false,
      binaryPath: 'C:\\test\\binary.exe',
      error: 'Download failed: Network timeout',
    }));

    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} downloadFn={mockDownload} />,
    );

    await delay(100);
    expect(lastFrame()).toContain('Network timeout');
  });

  it('does not download for unsupported platform', async () => {
    const mockDownload = vi.fn(async () => ({ success: true, binaryPath: 'test' }));

    render(
      <App
        platform={makePlatform({ isSupported: false, displayName: 'freebsd x64 (unsupported)' })}
        flags={defaultFlags}
        {...allMocks}
        downloadFn={mockDownload}
      />,
    );

    await delay(50);
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

describe('App - registration integration', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('runs registration after successful download', async () => {
    const mockRegister = vi.fn(async () => ({
      success: true,
      manifestPath: 'C:\\test\\manifest.json',
    }));

    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} registerFn={mockRegister} />,
    );

    await delay(150);
    expect(mockRegister).toHaveBeenCalled();
    expect(lastFrame()).toContain('registered');
  });

  it('shows registration error', async () => {
    const mockRegister = vi.fn(async () => ({
      success: false,
      manifestPath: 'test',
      error: 'Registration failed: EPERM',
    }));

    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} registerFn={mockRegister} />,
    );

    await delay(150);
    expect(lastFrame()).toContain('EPERM');
  });

  it('passes extensionId flag to register function', async () => {
    const flagsWithId: CliFlags = { ...defaultFlags, extensionId: 'myext123' };
    const mockRegister = vi.fn(async () => ({
      success: true,
      manifestPath: 'test',
    }));

    render(
      <App platform={makePlatform()} flags={flagsWithId} {...allMocks} registerFn={mockRegister} />,
    );

    await delay(150);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      'myext123',
    );
  });
});

describe('App - health check', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('shows health-ok after successful flow', async () => {
    const { lastFrame } = render(
      <App platform={makePlatform()} flags={defaultFlags} {...allMocks} />,
    );

    await delay(200);
    expect(lastFrame()).toContain('Bridge verified');
  });

  it('shows health-fail when binary is not healthy', async () => {
    const { lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={defaultFlags}
        {...allMocks}
        checkHealthFn={() => ({ healthy: false, binaryPath: 'test', error: 'not found' })}
      />,
    );

    await delay(200);
    expect(lastFrame()).toContain('health check failed');
  });
});

describe('App - tool discovery', () => {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const makeDetectorResult = (name: string, slug: string, installed: boolean) => ({
    detector: {
      name,
      slug,
      detect: async () => ({ installed }),
      writeConfig: async () => ({ success: true, action: 'created' as const }),
      verifyConfig: async () => true,
    },
    detection: { installed },
  });

  it('shows scanning then results after health check', async () => {
    const mockRunDetectors = vi.fn(async () => [
      makeDetectorResult('Claude Desktop', 'claude-desktop', true),
      makeDetectorResult('VS Code', 'vscode', false),
    ]);

    const { lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={defaultFlags}
        {...allMocks}
        runDetectorsFn={mockRunDetectors}
      />,
    );

    await delay(300);
    expect(mockRunDetectors).toHaveBeenCalled();
    const frame = lastFrame();
    expect(frame).toContain('Claude Desktop');
  });

  it('shows none-found when no tools detected', async () => {
    const mockRunDetectors = vi.fn(async () => [
      makeDetectorResult('Claude Desktop', 'claude-desktop', false),
      makeDetectorResult('VS Code', 'vscode', false),
    ]);

    const { lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={defaultFlags}
        {...allMocks}
        runDetectorsFn={mockRunDetectors}
      />,
    );

    await delay(300);
    expect(lastFrame()).toContain('No AI tools found');
  });

  it('auto-configures when --yes flag and tools found', async () => {
    const writeConfigFn = vi.fn(async () => ({ success: true, action: 'created' as const }));
    const mockRunDetectors = vi.fn(async () => [{
      detector: {
        name: 'Claude Desktop',
        slug: 'claude-desktop',
        detect: async () => ({ installed: true }),
        writeConfig: writeConfigFn,
        verifyConfig: async () => true,
      },
      detection: { installed: true },
    }]);

    const { lastFrame } = render(
      <App
        platform={makePlatform()}
        flags={{ ...defaultFlags, yes: true }}
        {...allMocks}
        runDetectorsFn={mockRunDetectors}
      />,
    );

    await delay(400);
    expect(writeConfigFn).toHaveBeenCalled();
  });
});
