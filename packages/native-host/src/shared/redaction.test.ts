import { describe, it, expect } from 'vitest';
import { redact, redactError, redactUrl } from './redaction.js';

describe('redact — primitive passthrough', () => {
  it('preserves numbers, booleans, null, undefined', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(false)).toBe(false);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('preserves short, non-URL strings as-is', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact('chrome:abc:55')).toBe('chrome:abc:55'); // tab ID survives
  });
});

describe('redact — shape-based string redaction', () => {
  it('redacts URLs to scheme + host + [redacted]', () => {
    expect(redact('https://gmail.com/u/0/inbox?q=secret')).toBe('https://gmail.com/[redacted]');
    expect(redact('http://localhost:8080/api/v1/data')).toBe('http://localhost:8080/[redacted]');
  });

  it('redacts overlong strings to length only', () => {
    const longStr = 'x'.repeat(250);
    expect(redact(longStr)).toBe('[len=250]');
  });

  it('redacts JWT-shaped strings completely', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_part_long_enough';
    expect(redact(jwt)).toBe('[REDACTED-JWT]');
  });

  it('does NOT mistake namespaced tab IDs for JWTs', () => {
    // "chrome:abc-123:55" has only 2 colons, won't match JWT_RE (needs dots).
    expect(redact('chrome:abc-123:622786441')).toBe('chrome:abc-123:622786441');
  });

  it('does NOT mistake semver strings for JWTs (Tier 1 bug fix)', () => {
    // The pre-fix regex /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    // matched ANY a.b.c shape — turning '0.5.6' into [REDACTED-JWT].
    expect(redact('0.5.6')).toBe('0.5.6');
    expect(redact('1.2.3')).toBe('1.2.3');
    expect(redact('10.20.30')).toBe('10.20.30');
  });

  it('does NOT mistake dotted identifiers for JWTs (Tier 1 bug fix)', () => {
    // Similarly common shapes that previously hit JWT_RE.
    expect(redact('foo.bar.baz')).toBe('foo.bar.baz');
    expect(redact('a.b.c')).toBe('a.b.c');
    expect(redact('main.production.us-east-1')).toBe('main.production.us-east-1');
  });

  it('still catches genuinely long JWTs (no regression)', () => {
    // RFC 7519 JWTs always exceed the minimum-segment-length guards.
    const realJWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(realJWT)).toBe('[REDACTED-JWT]');
  });
});

describe('redact — key-based field redaction', () => {
  it('replaces secret-named keys with [REDACTED-SECRET]', () => {
    const input = {
      cookie: 'sessionid=abc123',
      authorization: 'Bearer xyz',
      apiKey: 'sk-...',
      password: 'p@ss',
      somethingElse: 'visible',
    };
    const out = redact(input) as Record<string, string>;
    expect(out.cookie).toBe('[REDACTED-SECRET]');
    expect(out.authorization).toBe('[REDACTED-SECRET]');
    expect(out.apiKey).toBe('[REDACTED-SECRET]');
    expect(out.password).toBe('[REDACTED-SECRET]');
    expect(out.somethingElse).toBe('visible');
  });

  it('redacts URL-named keys to scheme + host + [redacted]', () => {
    const input = {
      url: 'https://example.com/secret/path?token=abc',
      href: 'http://my.app/admin',
      target: 'https://kept-by-default.com/path',
    };
    const out = redact(input) as Record<string, string>;
    expect(out.url).toBe('https://example.com/[redacted]');
    expect(out.href).toBe('http://my.app/[redacted]');
    // `target` is NOT in URL_KEYS, so it goes through shape-based →
    // redacted as URL because it parses as one.
    expect(out.target).toBe('https://kept-by-default.com/[redacted]');
  });

  it('replaces text fields with [len=N]', () => {
    const input = {
      value: 'user@example.com',
      title: 'My Page Title',
      placeholder: 'Enter email',
      selector: '#main > div.x1abc[data-pressable-container="true"]',
      something: 'short value',
    };
    const out = redact(input) as Record<string, string>;
    expect(out.value).toBe('[len=16]');
    expect(out.title).toBe('[len=13]');
    expect(out.placeholder).toBe('[len=11]');
    expect(out.selector).toMatch(/^\[len=\d+\]$/);
    // `something` is not a known sensitive key and is short; passes through.
    expect(out.something).toBe('short value');
  });

  it('preserves verb-style action fields as-is (Tier 1 bug fix)', () => {
    // Pre-fix, `action` was in URL_KEYS, so 'get_service_status' was URL-
    // redacted (→ `[len=18]` since it's not a parseable URL). That hid the
    // very thing an LLM debugging a helper invocation would grep for.
    const input = {
      action: 'get_service_status',
      anotherAction: 'start_native_host',
    };
    const out = redact(input) as Record<string, string>;
    expect(out.action).toBe('get_service_status');
    expect(out.anotherAction).toBe('start_native_host');
  });

  it('still redacts genuine form action URLs when caller uses an explicit URL key', () => {
    // Callers logging an actual HTML <form action="..."> URL should use a
    // URL_KEYS-listed name like `formActionUrl` instead of bare `action`.
    const input = { formActionUrl: 'https://api.example.com/submit?session=abc' };
    const out = redact(input) as Record<string, string>;
    expect(out.formActionUrl).toBe('https://api.example.com/[redacted]');
  });

  it('summarizes record arrays with length + sample keys', () => {
    const input = {
      rows: [
        { name: 'Alice', email: 'alice@x.com', joined: '2026-01-01' },
        { name: 'Bob', email: 'bob@x.com', joined: '2026-01-02' },
      ],
    };
    const out = redact(input) as Record<string, string>;
    expect(out.rows).toMatch(/^\[arrayLen=2, sampleKeys=\[/);
    expect(out.rows).toContain('name');
    expect(out.rows).toContain('email');
  });

  it('handles empty arrays gracefully', () => {
    const out = redact({ rows: [] }) as Record<string, string>;
    expect(out.rows).toBe('[arrayLen=0]');
  });

  it('recurses into known nesting keys (metadata, params, etc)', () => {
    const input = {
      metadata: {
        url: 'https://example.com/path',
        title: 'Should be length-summarized',
      },
    };
    const out = redact(input) as { metadata: Record<string, string> };
    expect(out.metadata.url).toBe('https://example.com/[redacted]');
    expect(out.metadata.title).toBe('[len=27]');
  });
});

describe('redact — defensive', () => {
  it('returns a new structure (never mutates input)', () => {
    const input = { url: 'https://a.com/x' };
    const out = redact(input);
    expect(out).not.toBe(input);
    expect(input.url).toBe('https://a.com/x'); // original unchanged
  });

  it('handles deeply-nested objects up to a bound, then truncates', () => {
    // Build 20-level nesting.
    let deep: unknown = { leaf: 'value' };
    for (let i = 0; i < 20; i++) {
      deep = { next: deep };
    }
    const out = redact(deep);
    // Walks 16 levels; deeper truncates.
    expect(JSON.stringify(out)).toContain('[deep-truncated]');
  });

  it('handles functions and symbols (they cannot be JSON-serialized)', () => {
    const sym = Symbol('x');
    expect(redact(() => 1)).toBe('[function]');
    expect(redact(sym)).toBe('[symbol]');
  });
});

describe('redact — realistic tool args (from tool-dispatcher.ts)', () => {
  it('redacts fill_form fields without leaking values', () => {
    const args = {
      fields: [
        { ref: 'e3', value: 'user@example.com' },
        { ref: 'e4', value: 'p@ssw0rd' },
        { selector: '#address', value: '123 Main St' },
      ],
      tab_id: 'chrome:abc:55',
    };
    const out = redact(args) as { fields: Array<Record<string, string>>; tab_id: string };
    expect(out.tab_id).toBe('chrome:abc:55');
    expect(out.fields[0].value).toBe('[len=16]');
    expect(out.fields[1].value).toBe('[len=8]');
    expect(out.fields[2].value).toBe('[len=11]');
    expect(out.fields[2].selector).toMatch(/^\[len=\d+\]$/);
    // ref preserved (not in any sensitive set)
    expect(out.fields[0].ref).toBe('e3');
  });

  it('redacts navigate args without leaking URL paths', () => {
    const args = { url: 'https://gmail.com/u/0/inbox/private-thread-id', tab_id: 'chrome:abc:55' };
    const out = redact(args) as Record<string, string>;
    expect(out.url).toBe('https://gmail.com/[redacted]');
    expect(out.tab_id).toBe('chrome:abc:55');
  });

  it('redacts extract_data response rows', () => {
    const result = {
      content: 'Here is your data:',
      rows: [
        { id: '1', email: 'a@x.com' },
        { id: '2', email: 'b@x.com' },
      ],
    };
    const out = redact(result) as Record<string, string>;
    expect(out.content).toMatch(/^\[len=\d+\]$/);
    expect(out.rows).toMatch(/^\[arrayLen=2,/);
  });
});

describe('redactUrl — edge cases', () => {
  it('preserves port number in host', () => {
    expect(redactUrl('http://localhost:8080/api/x')).toBe('http://localhost:8080/[redacted]');
  });

  it('handles fragment URLs', () => {
    expect(redactUrl('https://a.com/page#section-3')).toBe('https://a.com/[redacted]');
  });

  it('falls back to length when URL is unparseable', () => {
    // Strange protocol with empty host — URL constructor will throw.
    expect(redactUrl('not-a-real-url')).toBe('[len=14]');
  });
});

describe('redactError', () => {
  it('reduces an Error to safe shape', () => {
    const err = new Error('Connection to https://api.x.com/secret failed');
    const out = redactError(err);
    expect(out.errorName).toBe('Error');
    // Embedded URL gets in-place redaction; secret path is gone.
    expect(out.errorMessage).toBe('Connection to https://api.x.com/[redacted] failed');
    expect(out.errorMessage).not.toContain('secret');
    expect(out.stack).toBeDefined();
  });

  it('preserves errorCode (our short identifiers)', () => {
    const err = Object.assign(new Error('msg'), { code: 'TAB_NOT_FOUND' });
    const out = redactError(err);
    expect(out.errorCode).toBe('TAB_NOT_FOUND');
  });

  it('handles string throws', () => {
    const out = redactError('https://leaked.example/path was thrown');
    expect(out.errorName).toBe('StringError');
    // Whole thing went through redactString — exceeds 200? no, ~40 chars
    // But it contains a URL substring — string-shape redaction only triggers
    // on FULL URL strings, not embedded. So the whole string passes if
    // <= 200 chars.
    expect(out.errorMessage.length).toBeGreaterThan(0);
  });

  it('handles plain-object throws (extension dispatcher pattern)', () => {
    const thrown = { message: 'tab_id is required', code: 'TAB_NOT_FOUND' };
    const out = redactError(thrown);
    expect(out.errorName).toBe('ObjectError');
    expect(out.errorMessage).toBe('tab_id is required');
    expect(out.errorCode).toBe('TAB_NOT_FOUND');
  });

  it('redacts URLs embedded in stack traces', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at fetch (https://internal.tool.com/api/v3/users)\n    at handler';
    const out = redactError(err);
    expect(out.stack).toContain('https://internal.tool.com/[redacted]');
    expect(out.stack).not.toContain('/api/v3/users');
  });

  it('caps stack at 20 lines', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n' + Array.from({ length: 50 }, (_, i) => `    at fn${i}`).join('\n');
    const out = redactError(err);
    const lines = (out.stack ?? '').split('\n');
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});
