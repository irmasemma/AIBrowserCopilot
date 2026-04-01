import { describe, it, expect } from 'vitest';
import { getStateConfig } from './status-badge';
import type { ConnectionState } from '../../shared/types';

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

  it('connected → green, "Connected"', () => {
    const cfg = getStateConfig('connected');
    expect(cfg.label).toBe('Connected');
    expect(cfg.colorClass).toContain('green');
    expect(cfg.pulse).toBe(false);
    expect(cfg.badge).toBe(false);
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
});
