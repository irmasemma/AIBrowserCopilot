import { describe, it, expect } from 'vitest';
import { getStateConfig } from './status-badge';

describe('getStateConfig', () => {
  it('disconnected → gray, "Not Connected"', () => {
    const cfg = getStateConfig('disconnected');
    expect(cfg.label).toBe('Not Connected');
    expect(cfg.colorClass).toContain('neutral');
    expect(cfg.icon).toBe('○');
    expect(cfg.pulse).toBe(false);
    expect(cfg.badge).toBe(false);
  });

  it('connecting → amber pulse, "Connecting..."', () => {
    const cfg = getStateConfig('connecting');
    expect(cfg.label).toBe('Connecting...');
    expect(cfg.colorClass).toContain('amber');
    expect(cfg.pulse).toBe(true);
    expect(cfg.badge).toBe(false);
  });

  it('connected → green, "Tools working"', () => {
    const cfg = getStateConfig('connected');
    expect(cfg.label).toBe('Tools working');
    expect(cfg.colorClass).toContain('green');
    expect(cfg.pulse).toBe(false);
    expect(cfg.badge).toBe(false);
  });

  it('working → green, "Tools working" (the only green)', () => {
    const cfg = getStateConfig('working');
    expect(cfg.label).toBe('Tools working');
    expect(cfg.colorClass).toContain('green');
  });

  it('untested → amber with "?" glyph badge, NOT green', () => {
    const cfg = getStateConfig('untested');
    expect(cfg.label).toBe('Not yet tested');
    expect(cfg.colorClass).not.toContain('green');
    expect(cfg.icon).toBe('?');
    expect(cfg.badge).toBe(true);
  });

  it('flapping → red pulse with distinct ↻ icon', () => {
    const cfg = getStateConfig('flapping');
    expect(cfg.label).toBe('Connection keeps dropping');
    expect(cfg.colorClass).toContain('red');
    expect(cfg.icon).toBe('↻');
    expect(cfg.pulse).toBe(true);
  });

  it('recovering → distinct ◍ icon, NOT the green dot', () => {
    const cfg = getStateConfig('recovering');
    expect(cfg.label).toBe('Reconnecting…');
    expect(cfg.colorClass).not.toContain('green');
    expect(cfg.icon).toBe('◍');
    expect(cfg.pulse).toBe(true);
  });

  it('degraded → amber with badge, "Unstable"', () => {
    const cfg = getStateConfig('degraded');
    expect(cfg.label).toBe('Unstable');
    expect(cfg.colorClass).toContain('amber');
    expect(cfg.pulse).toBe(false);
    expect(cfg.badge).toBe(true);
  });

  it('reconnecting → amber pulse, "Reconnecting..."', () => {
    const cfg = getStateConfig('reconnecting');
    expect(cfg.label).toBe('Reconnecting...');
    expect(cfg.colorClass).toContain('amber');
    expect(cfg.pulse).toBe(true);
    expect(cfg.badge).toBe(false);
  });

  it('connected state uses green-500 class', () => {
    const cfg = getStateConfig('connected');
    expect(cfg.colorClass).toBe('bg-green-500');
  });

  it('stale → gray pulse, "Connection went quiet"', () => {
    const cfg = getStateConfig('stale');
    expect(cfg.label).toBe('Connection went quiet');
    expect(cfg.colorClass).toContain('neutral');
    expect(cfg.pulse).toBe(true);
    expect(cfg.badge).toBe(false);
  });
});
