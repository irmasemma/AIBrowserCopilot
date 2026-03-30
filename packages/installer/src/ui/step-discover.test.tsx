import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StepDiscover } from './step-discover.js';
import type { ToolDetectionSummary, ToolDetector } from '../detectors/types.js';

const makeDetector = (name: string, slug: string): ToolDetector => ({
  name,
  slug,
  detect: async () => ({ installed: false }),
  writeConfig: async () => ({ success: true, action: 'created' }),
  verifyConfig: async () => true,
});

const makeDetection = (
  name: string,
  slug: string,
  installed: boolean,
  hasExistingMcp = false,
): ToolDetectionSummary => ({
  detector: makeDetector(name, slug),
  detection: { installed, hasExistingMcp },
});

describe('StepDiscover', () => {
  it('renders scanning state', () => {
    const { lastFrame } = render(<StepDiscover phase="scanning" />);
    expect(lastFrame()).toContain('Scanning for AI tools');
  });

  it('renders none-found state', () => {
    const { lastFrame } = render(<StepDiscover phase="none-found" />);
    const frame = lastFrame();
    expect(frame).toContain('No AI tools found');
    expect(frame).toContain('Install Claude Desktop');
  });

  it('renders found tools with checkmarks', () => {
    const detections = [
      makeDetection('Claude Desktop', 'claude-desktop', true),
      makeDetection('VS Code', 'vscode', true),
      makeDetection('Cursor', 'cursor', false),
    ];

    const { lastFrame } = render(
      <StepDiscover phase="results" detections={detections} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Claude Desktop');
    expect(frame).toContain('VS Code');
    expect(frame).toContain('not found');
  });

  it('shows configure prompt when tools found', () => {
    const detections = [makeDetection('Claude Desktop', 'claude-desktop', true)];

    const { lastFrame } = render(
      <StepDiscover phase="results" detections={detections} />,
    );
    expect(lastFrame()).toContain('Configure these tools?');
    expect(lastFrame()).toContain('[Y/n]');
  });

  it('hides prompt when skipPrompt is true', () => {
    const detections = [makeDetection('Claude Desktop', 'claude-desktop', true)];

    const { lastFrame } = render(
      <StepDiscover phase="results" detections={detections} skipPrompt />,
    );
    expect(lastFrame()).not.toContain('[Y/n]');
  });

  it('shows already configured indicator', () => {
    const detections = [makeDetection('Claude Desktop', 'claude-desktop', true, true)];

    const { lastFrame } = render(
      <StepDiscover phase="results" detections={detections} />,
    );
    expect(lastFrame()).toContain('already configured');
  });

  it('calls onConfigureChoice with true when y pressed', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const onChoice = vi.fn();
    const detections = [makeDetection('Tool', 'tool', true)];

    const { stdin } = render(
      <StepDiscover phase="results" detections={detections} onConfigureChoice={onChoice} />,
    );
    await delay(50);
    stdin.write('y');
    await delay(50);
    expect(onChoice).toHaveBeenCalledWith(true);
  });

  it('calls onConfigureChoice with false when n pressed', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const onChoice = vi.fn();
    const detections = [makeDetection('Tool', 'tool', true)];

    const { stdin } = render(
      <StepDiscover phase="results" detections={detections} onConfigureChoice={onChoice} />,
    );
    await delay(50);
    stdin.write('n');
    await delay(50);
    expect(onChoice).toHaveBeenCalledWith(false);
  });

  it('renders config statuses during configuring phase', () => {
    const detections = [makeDetection('Claude Desktop', 'claude-desktop', true)];
    const configStatuses = [
      { slug: 'claude-desktop', name: 'Claude Desktop', status: 'success' as const },
      { slug: 'vscode', name: 'VS Code', status: 'writing' as const },
      { slug: 'cursor', name: 'Cursor', status: 'error' as const, error: 'Permission denied' },
    ];

    const { lastFrame } = render(
      <StepDiscover phase="configuring" detections={detections} configStatuses={configStatuses} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Configuring');
    expect(frame).toContain('Claude Desktop');
    expect(frame).toContain('VS Code');
    expect(frame).toContain('Permission denied');
  });
});
