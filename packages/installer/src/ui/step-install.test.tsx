import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StepInstall } from './step-install.js';
import type { PlatformInfo } from '../shared/platform.js';

const makePlatform = (overrides: Partial<PlatformInfo> = {}): PlatformInfo => ({
  os: 'windows',
  arch: 'x64',
  homeDir: 'C:\\Users\\test',
  isSupported: true,
  displayName: 'Windows x64',
  ...overrides,
});

describe('StepInstall', () => {
  it('renders downloading state with progress bar', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 500, totalBytes: 1000, percent: 50 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('Downloading');
    expect(frame).toContain('50%');
  });

  it('renders downloading state at 0%', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 0, totalBytes: 1000, percent: 0 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('0%');
  });

  it('renders downloading state at 100%', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 1000, totalBytes: 1000, percent: 100 }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('100%');
  });

  it('renders installing state', () => {
    const { lastFrame } = render(
      <StepInstall platform={makePlatform()} status="installing" />,
    );
    expect(lastFrame()).toContain('Installing');
  });

  it('renders complete state', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="complete"
        binaryPath="C:\\Users\\test\\AppData\\Local\\ai-browser-copilot\\ai-browser-copilot-win-x64.exe"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('complete');
  });

  it('renders error state with message', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="error"
        errorMessage="Network timeout"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('Network timeout');
  });

  it('shows binary name for platform', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform({ os: 'macos', arch: 'arm64', displayName: 'macOS arm64' })}
        status="downloading"
        progress={{ bytesReceived: 250, totalBytes: 1000, percent: 25 }}
      />,
    );
    expect(lastFrame()).toContain('ai-browser-copilot-macos-arm64');
  });

  it('shows progress bar visual representation', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 500, totalBytes: 1000, percent: 50 }}
      />,
    );
    const frame = lastFrame()!;
    // Progress bar should contain filled and unfilled characters
    expect(frame).toMatch(/[█▓░]/);
  });

  it('displays file size info during download', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 5242880, totalBytes: 10485760, percent: 50 }}
      />,
    );
    const frame = lastFrame()!;
    // Should show MB downloaded / total
    expect(frame).toContain('5.0');
    expect(frame).toContain('10.0');
  });

  it('output fits within 80 columns', () => {
    const { lastFrame } = render(
      <StepInstall
        platform={makePlatform()}
        status="downloading"
        progress={{ bytesReceived: 500, totalBytes: 1000, percent: 50 }}
      />,
    );
    const frame = lastFrame();
    if (frame) {
      const lines = frame.split('\n');
      for (const line of lines) {
        const clean = line.replace(/\u001b\[[0-9;]*m/g, '');
        expect(clean.length).toBeLessThanOrEqual(80);
      }
    }
  });
});
