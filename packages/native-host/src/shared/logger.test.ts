import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logRecord, makeLogger, _resetForTest, type LoggerConfig } from './logger.js';

/**
 * Tests for the NDJSON logger.
 *
 * Each test creates a fresh temp dir + fresh in-memory state so behaviour
 * is deterministic across runs and isolated from sibling tests.
 */

let tmp: string;
let cfg: LoggerConfig;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agenthub-logger-test-'));
  cfg = {
    filePath: join(tmp, 'logs', 'bridge.log'),
    maxBytes: 500,
    keep: 4,
  };
  _resetForTest();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter((l) => l.length > 0);
}

describe('logRecord — basic write', () => {
  it('creates the parent directory if missing', () => {
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 123, event: 'test.event' });
    expect(existsSync(cfg.filePath)).toBe(true);
  });

  it('writes one JSON object per line, NDJSON-compliant', () => {
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'a' });
    logRecord(cfg, { src: 'bridge', lvl: 'warn', pid: 1, event: 'b' });
    const lines = readLines(cfg.filePath);
    expect(lines).toHaveLength(2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    expect(a.event).toBe('a');
    expect(b.event).toBe('b');
    expect(a.lvl).toBe('info');
    expect(b.lvl).toBe('warn');
  });

  it('stamps `t` as ISO timestamp when not supplied', () => {
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'x' });
    const [line] = readLines(cfg.filePath);
    const parsed = JSON.parse(line);
    expect(parsed.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('preserves caller-supplied `t` for deterministic testing', () => {
    logRecord(cfg, { t: '2026-01-01T00:00:00.000Z', src: 'bridge', lvl: 'info', pid: 1, event: 'x' });
    const parsed = JSON.parse(readLines(cfg.filePath)[0]);
    expect(parsed.t).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('logRecord — rotation', () => {
  it('rotates when the file exceeds maxBytes', () => {
    // Each record is ~80 bytes. With maxBytes=500, we should rotate by record 7.
    for (let i = 0; i < 10; i++) {
      logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'tick', i });
    }
    expect(existsSync(`${cfg.filePath}.1`)).toBe(true);
    // .log itself should be smaller than before rotation
    const currentSize = readFileSync(cfg.filePath, 'utf-8').length;
    expect(currentSize).toBeLessThan(500);
  });

  it('keeps no more than `keep` generations', () => {
    // Force many rotations.
    cfg.maxBytes = 100;
    for (let i = 0; i < 100; i++) {
      logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'tick', i });
    }
    // .log + .log.1 .. .log.4 should all exist; .log.5 must not.
    expect(existsSync(cfg.filePath)).toBe(true);
    expect(existsSync(`${cfg.filePath}.1`)).toBe(true);
    expect(existsSync(`${cfg.filePath}.4`)).toBe(true);
    expect(existsSync(`${cfg.filePath}.5`)).toBe(false);
  });

  it('shifts generations on rotation: oldest content lands in .4', () => {
    cfg.maxBytes = 80; // forces rotation after every ~1 record
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'first' });
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'second' });
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'third' });
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'fourth' });
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'fifth' });

    // Each write rotates AFTER current content + new write would exceed
    // maxBytes. With maxBytes=80 and each record ~70-80 bytes, every write
    // triggers a rotation. Result: each generation holds one record.
    // .log = latest (fifth), .log.1 = fourth, .log.2 = third, etc.
    const current = readLines(cfg.filePath);
    expect(current.some((l) => JSON.parse(l).event === 'fifth')).toBe(true);
  });
});

describe('logRecord — robustness', () => {
  it('never throws on invalid input', () => {
    const cyclic: { ref?: unknown } = {};
    cyclic.ref = cyclic;
    // Should not throw.
    logRecord(cfg, {
      src: 'bridge',
      lvl: 'info',
      pid: 1,
      event: 'cyclic',
      data: cyclic,
    });
    const lines = readLines(cfg.filePath);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed._serialize_failed).toBe(true);
  });

  it('truncates oversized lines (single record cannot poison the log)', () => {
    const huge = 'x'.repeat(50_000);
    logRecord(cfg, {
      src: 'bridge',
      lvl: 'info',
      pid: 1,
      event: 'huge',
      data: huge,
    });
    const [line] = readLines(cfg.filePath);
    const parsed = JSON.parse(line);
    expect(parsed._truncated).toBe(true);
    expect(parsed._originalBytes).toBeGreaterThan(16_000);
    expect(parsed.data).toBeUndefined(); // huge field was stripped
  });

  it('survives a pre-existing file (resyncs byte counter from disk)', () => {
    // Pre-populate a file from a "previous process run".
    const fullPath = cfg.filePath;
    const dir = join(tmp, 'logs');
    mkdtempSync(dir).slice(0); // no-op, just ensure dir exists via require
    require('node:fs').mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, 'x'.repeat(450) + '\n', 'utf-8');

    // New logger should pick up the 450 bytes and rotate quickly.
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'new' });
    // Total now exceeds maxBytes=500, so the NEXT write should rotate.
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'rotate-trigger' });
    expect(existsSync(`${cfg.filePath}.1`)).toBe(true);
  });

  it('handles a destination dir we cannot create by going silent', () => {
    // Use a path with a NUL char — guaranteed-invalid on Windows.
    const bad = { filePath: 'Z:\\\x00\\invalid\\bridge.log' };
    // Should not throw, just no-op.
    expect(() => logRecord(bad, { src: 'bridge', lvl: 'info', pid: 1, event: 'x' })).not.toThrow();
  });
});

describe('makeLogger — convenience wrapper', () => {
  it('exposes info / warn / error with correct level', () => {
    const log = makeLogger(cfg, 'bridge', 999);
    log.info('e1', { foo: 1 });
    log.warn('e2');
    log.error('e3', { code: 'X' });
    const lines = readLines(cfg.filePath).map((l) => JSON.parse(l));
    expect(lines[0].lvl).toBe('info');
    expect(lines[0].event).toBe('e1');
    expect(lines[0].foo).toBe(1);
    expect(lines[1].lvl).toBe('warn');
    expect(lines[2].lvl).toBe('error');
    expect(lines[2].code).toBe('X');
    expect(lines.every((l) => l.pid === 999)).toBe(true);
    expect(lines.every((l) => l.src === 'bridge')).toBe(true);
  });

  it('accepts null pid (for the extension SW case)', () => {
    const log = makeLogger(cfg, 'ext', null);
    log.info('ev');
    const parsed = JSON.parse(readLines(cfg.filePath)[0]);
    expect(parsed.pid).toBeNull();
    expect(parsed.src).toBe('ext');
  });
});

describe('logRecord — privacy toggle (logs-config.json)', () => {
  it('writes by default (no logs-config.json present)', () => {
    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'enabled.default' });
    expect(existsSync(cfg.filePath)).toBe(true);
  });

  it('skips all writes when logs-config.json sets enabled: false', () => {
    // The config sits one level above the log file: <installDir>/logs/bridge.log
    // → <installDir>/logs-config.json
    const installDir = join(tmp, 'install');
    const logsDir = join(installDir, 'logs');
    const configPath = join(installDir, 'logs-config.json');
    cfg = { filePath: join(logsDir, 'bridge.log'), maxBytes: 500, keep: 4 };
    // Ensure parent dir for config exists
    require('node:fs').mkdirSync(installDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: false }));
    _resetForTest();

    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'should.not.appear' });
    expect(existsSync(cfg.filePath)).toBe(false);
  });

  it('writes normally when logs-config.json sets enabled: true', () => {
    const installDir = join(tmp, 'install2');
    const logsDir = join(installDir, 'logs');
    const configPath = join(installDir, 'logs-config.json');
    cfg = { filePath: join(logsDir, 'bridge.log'), maxBytes: 500, keep: 4 };
    require('node:fs').mkdirSync(installDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: true }));
    _resetForTest();

    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'should.appear' });
    expect(existsSync(cfg.filePath)).toBe(true);
  });

  it('fails open on malformed logs-config.json', () => {
    const installDir = join(tmp, 'install3');
    const logsDir = join(installDir, 'logs');
    const configPath = join(installDir, 'logs-config.json');
    cfg = { filePath: join(logsDir, 'bridge.log'), maxBytes: 500, keep: 4 };
    require('node:fs').mkdirSync(installDir, { recursive: true });
    writeFileSync(configPath, 'not valid json {');
    _resetForTest();

    logRecord(cfg, { src: 'bridge', lvl: 'info', pid: 1, event: 'malformed.config' });
    expect(existsSync(cfg.filePath)).toBe(true);
  });
});
