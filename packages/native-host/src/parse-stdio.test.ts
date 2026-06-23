import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseStdioMessages } from './service.js';

const feed = (chunks: (string | Buffer)[]): Readable => {
  const r = new Readable({ read() {} });
  for (const c of chunks) r.push(c);
  r.push(null);
  return r;
};

const collect = async (
  chunks: (string | Buffer)[],
  formatHolder?: { format: 'ndjson' | 'lsp' },
): Promise<string[]> => {
  const got: string[] = [];
  const stream = feed(chunks);
  parseStdioMessages(stream, (json) => got.push(json), formatHolder);
  await new Promise<void>((resolve) => stream.on('end', () => setImmediate(resolve)));
  return got;
};

const ndjson = (obj: unknown): string => `${JSON.stringify(obj)}\n`;
const lsp = (obj: unknown): string => {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

describe('parseStdioMessages — NDJSON (real MCP wire format)', () => {
  it('parses a single NDJSON message', async () => {
    const got = await collect([ndjson({ jsonrpc: '2.0', id: 1, method: 'initialize' })]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0])).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  });

  it('parses multiple NDJSON messages in one chunk', async () => {
    const a = ndjson({ id: 1, method: 'initialize' });
    const b = ndjson({ id: 2, method: 'tools/list' });
    const got = await collect([a + b]);
    expect(got).toHaveLength(2);
    expect(JSON.parse(got[0]).id).toBe(1);
    expect(JSON.parse(got[1]).id).toBe(2);
  });

  it('handles NDJSON split across chunks', async () => {
    const body = JSON.stringify({ id: 1, method: 'initialize' });
    const got = await collect([
      Buffer.from(body.slice(0, 10)),
      Buffer.from(body.slice(10)),
      Buffer.from('\n'),
    ]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(1);
  });

  it('handles \\r\\n line endings (some clients)', async () => {
    const body = JSON.stringify({ id: 1 });
    const got = await collect([`${body}\r\n`]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(1);
  });

  it('skips leading whitespace before NDJSON', async () => {
    const got = await collect([`\n\n  ${ndjson({ id: 7 })}`]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(7);
  });

  it('parses NDJSON batch (top-level array)', async () => {
    const got = await collect([`${JSON.stringify([{ id: 1 }, { id: 2 }])}\n`]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('latches format=ndjson on first NDJSON parse', async () => {
    const holder: { format: 'ndjson' | 'lsp' } = { format: 'ndjson' };
    await collect([ndjson({ id: 1 })], holder);
    expect(holder.format).toBe('ndjson');
  });
});

describe('parseStdioMessages — Content-Length (LSP-style legacy)', () => {
  it('parses a single LSP-framed message', async () => {
    const got = await collect([lsp({ id: 1, method: 'initialize' })]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(1);
  });

  it('parses multiple LSP-framed messages in one chunk', async () => {
    const got = await collect([lsp({ id: 1 }) + lsp({ id: 2 })]);
    expect(got).toHaveLength(2);
    expect(JSON.parse(got[0]).id).toBe(1);
    expect(JSON.parse(got[1]).id).toBe(2);
  });

  it('handles LSP body split across chunks', async () => {
    const body = JSON.stringify({ id: 1 });
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    const got = await collect([header + body.slice(0, 4), body.slice(4)]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(1);
  });

  it('latches format=lsp on first LSP parse', async () => {
    const holder: { format: 'ndjson' | 'lsp' } = { format: 'ndjson' };
    await collect([lsp({ id: 1 })], holder);
    expect(holder.format).toBe('lsp');
  });
});

describe('parseStdioMessages — robustness', () => {
  it('does not change latch on subsequent messages', async () => {
    const holder: { format: 'ndjson' | 'lsp' } = { format: 'ndjson' };
    // First NDJSON, then LSP — latch must stay ndjson.
    await collect([ndjson({ id: 1 }), lsp({ id: 2 })], holder);
    expect(holder.format).toBe('ndjson');
  });

  it('produces no messages from pure whitespace', async () => {
    const got = await collect(['\n\r\n   \t\n']);
    expect(got).toHaveLength(0);
  });

  it('skips unrecognized headers without Content-Length', async () => {
    const body = JSON.stringify({ id: 1 });
    const stray = `X-Junk: 1\r\n\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const got = await collect([stray]);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]).id).toBe(1);
  });
});
