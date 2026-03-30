import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StepRegister } from './step-register.js';

describe('StepRegister', () => {
  it('renders registering state', () => {
    const { lastFrame } = render(
      <StepRegister status="registering" />,
    );
    expect(lastFrame()).toContain('Registering');
  });

  it('renders complete state with manifest path', () => {
    const { lastFrame } = render(
      <StepRegister
        status="complete"
        manifestPath="C:\\Users\\test\\AppData\\Local\\ai-browser-copilot\\com.copilot.native_host.json"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('registered');
    expect(frame).toContain('com.copilot.native_host.json');
  });

  it('renders error state with message', () => {
    const { lastFrame } = render(
      <StepRegister
        status="error"
        errorMessage="Permission denied writing manifest"
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('failed');
    expect(frame).toContain('Permission denied');
  });

  it('hides manifest path when not provided on complete', () => {
    const { lastFrame } = render(
      <StepRegister status="complete" />,
    );
    const frame = lastFrame();
    expect(frame).toContain('registered');
    expect(frame).not.toContain('Manifest:');
  });

  it('hides error message when not provided on error', () => {
    const { lastFrame } = render(
      <StepRegister status="error" />,
    );
    const frame = lastFrame();
    expect(frame).toContain('failed');
  });
});
