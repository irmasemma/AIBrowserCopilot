import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StepDetect } from './step-detect.js';

describe('StepDetect', () => {
  it('renders checking state', () => {
    const { lastFrame } = render(<StepDetect status="checking" />);
    expect(lastFrame()).toContain('Checking for existing installation');
  });

  it('renders not-found state', () => {
    const { lastFrame } = render(<StepDetect status="not-found" />);
    expect(lastFrame()).toContain('No existing installation found');
  });

  it('renders found state with binary path', () => {
    const { lastFrame } = render(
      <StepDetect status="found" binaryPath="C:\\test\\binary.exe" />,
    );
    const frame = lastFrame();
    expect(frame).toContain('already installed');
    expect(frame).toContain('binary.exe');
  });

  it('shows update prompt when found and not skipping', () => {
    const { lastFrame } = render(
      <StepDetect status="found" />,
    );
    expect(lastFrame()).toContain('Update to latest?');
    expect(lastFrame()).toContain('[Y/n]');
  });

  it('hides prompt when skipPrompt is true', () => {
    const { lastFrame } = render(
      <StepDetect status="found" skipPrompt />,
    );
    expect(lastFrame()).toContain('already installed');
    expect(lastFrame()).not.toContain('[Y/n]');
  });

  it('calls onUpdateChoice with true when y is pressed', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const onChoice = vi.fn();
    const { stdin } = render(
      <StepDetect status="found" onUpdateChoice={onChoice} />,
    );

    await delay(50);
    stdin.write('y');
    await delay(50);
    expect(onChoice).toHaveBeenCalledWith(true);
  });

  it('calls onUpdateChoice with false when n is pressed', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const onChoice = vi.fn();
    const { stdin } = render(
      <StepDetect status="found" onUpdateChoice={onChoice} />,
    );

    await delay(50);
    stdin.write('n');
    await delay(50);
    expect(onChoice).toHaveBeenCalledWith(false);
  });

  it('renders health-ok state', () => {
    const { lastFrame } = render(<StepDetect status="health-ok" />);
    expect(lastFrame()).toContain('Bridge verified');
  });

  it('renders health-fail state', () => {
    const { lastFrame } = render(<StepDetect status="health-fail" />);
    const frame = lastFrame();
    expect(frame).toContain('health check failed');
    expect(frame).toContain('reinstalling');
  });

  it('hides prompt after answering', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const onChoice = vi.fn();
    const { stdin, lastFrame } = render(
      <StepDetect status="found" onUpdateChoice={onChoice} />,
    );

    await delay(50);
    stdin.write('y');
    await delay(50);
    expect(lastFrame()).not.toContain('[Y/n]');
  });
});
