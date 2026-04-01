import { describe, it, expect } from 'vitest';
import { formatUptime } from './diagnostics-panel';

describe('formatUptime', () => {
  it('formats 0 seconds', () => {
    expect(formatUptime(0)).toBe('0s');
  });

  it('formats 30 seconds', () => {
    expect(formatUptime(30)).toBe('30s');
  });

  it('formats 59 seconds', () => {
    expect(formatUptime(59)).toBe('59s');
  });

  it('formats 60 seconds as 1m 0s', () => {
    expect(formatUptime(60)).toBe('1m 0s');
  });

  it('formats 65 seconds as 1m 5s', () => {
    expect(formatUptime(65)).toBe('1m 5s');
  });

  it('formats 3600 seconds as 1h 0m', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
  });

  it('formats 3661 seconds as 1h 1m', () => {
    expect(formatUptime(3661)).toBe('1h 1m');
  });

  it('formats 7200 seconds as 2h 0m', () => {
    expect(formatUptime(7200)).toBe('2h 0m');
  });

  it('formats fractional seconds by flooring', () => {
    expect(formatUptime(30.9)).toBe('30s');
  });
});
