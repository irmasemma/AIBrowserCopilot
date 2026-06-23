/**
 * Recursive redaction for log payloads.
 *
 * Logs may include MCP tool args, response envelopes, errors — anything
 * the caller wants to record. Those can contain page content, URLs,
 * cookies, form values, page-derived strings — material we should not
 * persist to a debug log readable by any local LLM.
 *
 * Strategy:
 *   1. **Key-based**: certain field names are always sensitive
 *      (`value`, `text`, `url`, `cookie`, etc). Replace by structural
 *      summary (`[len=N]`, `[REDACTED-SECRET]`).
 *   2. **Shape-based**: any string value, regardless of key, is checked
 *      against URL / JWT / overlong patterns and redacted if it matches.
 *
 * Both layers apply. Key-based wins for ambiguous cases (a field literally
 * named `cookie` is redacted as a secret even if the value looks short).
 *
 * The function NEVER mutates the input. It always returns a fresh
 * structure. Callers can safely log the original object elsewhere.
 *
 * Performance: walks the entire tree once. For typical tool args
 * (~10–100 fields), this is microseconds. No regex-precompile concerns
 * because the regexes are module-level constants.
 */

// ── Key categories ────────────────────────────────────────────────────────

/**
 * Field names whose VALUES are URLs. We keep scheme + host, replace
 * the rest with `[redacted]`. Comparison is case-insensitive.
 */
const URL_KEYS = new Set([
  'url',
  'href',
  'targeturl',
  'link',
  'location',
  'src',
  // NOTE: `action` was deliberately removed (it was originally added with
  // HTML `<form action="...">` in mind). In practice the field name
  // `action` appears far more often as a verb in our codebase
  // (e.g. helper RPC actions like 'get_service_status', 'start_native_host')
  // than as a URL. Callers that genuinely log a form action should pass
  // it under one of the URL_KEYS names instead (e.g. `formActionUrl`).
  'referrer',
  'redirecturi',
]);

/**
 * Field names that hold page-derived or user-typed text. Replace with
 * `[len=N]` so downstream debugging knows whether the field was present
 * + roughly how big, without leaking content.
 */
const TEXT_KEYS = new Set([
  'value',
  'values',
  'text',
  'body',
  'content',
  'innertext',
  'innerhtml',
  'outerhtml',
  'title',
  'pagetitle',
  'query',
  'searchquery',
  'q',
  'label',
  'name',
  'placeholder',
  'description',
  'alt',
  'visibletext',
  'snapshot',
  'ariasnapshot',
  'pagecontent',
  'selector',
  'css',
  'xpath',
  'message',
]);

/**
 * Field names that hold arrays of records (scraped tables, snapshot trees).
 * Replace with a summary that tells you the size + what kind of records
 * they were, without the rows themselves.
 *
 * Note: `fields` (form-fill input) is NOT included here. We want
 * per-entry redaction of `fields[*].value` so logs show that 3 form
 * fields were filled with length-summarized values, rather than just
 * `[arrayLen=3]`. The user wants enough information to debug.
 */
const RECORD_ARRAY_KEYS = new Set([
  'rows',
  'cells',
  'data',
  'entries',
  'items',
  'results',
  'tabs',
  'records',
]);

/**
 * Field names whose VALUES are secrets — credentials, auth tokens,
 * cookies. Replace with `[REDACTED-SECRET]`. We don't even log length,
 * because length itself can leak (e.g. a known fixed-length API key).
 */
const SECRET_KEYS = new Set([
  'cookie',
  'cookies',
  'authorization',
  'auth',
  'token',
  'apikey',
  'api_key',
  'password',
  'pwd',
  'secret',
  'privatekey',
  'private_key',
  'sessionid',
  'session_id',
  'csrf',
]);

/**
 * Field names that hold nested objects to recurse into (rather than
 * stringify). Lets us redact `metadata.url` correctly.
 */
const RECURSE_KEYS = new Set([
  'metadata',
  'meta',
  'og',
  'opengraph',
  'options',
  'config',
  'params',
  'arguments',
  'request',
  'response',
  'result',
  'context',
]);

// ── Shape detectors ───────────────────────────────────────────────────────

/**
 * Loose URL detector — anchored. Used when the entire string is being
 * tested ("is this string a URL"). Used by `redactString` for full-value
 * shape detection.
 */
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/$.?#].\S*$/;

/**
 * URL substring detector — unanchored. Used when we want to find URLs
 * INSIDE a longer string (error messages, stack trace lines). Each match
 * is run through `redactUrl()`.
 */
const URL_SUBSTRING_RE = /https?:\/\/[^\s'"\)<>]+/g;

/**
 * JWT pattern (3 base64url segments separated by `.`).
 *
 * False-positive guard: a naive `a.b.c` pattern matches any 3 dot-separated
 * identifiers, including semver strings like `0.5.6` and module paths like
 * `foo.bar.baz`. Real JWTs are produced from at least:
 *   - header  (~30 base64url chars: {"alg":"HS256","typ":"JWT"})
 *   - payload (~30+ base64url chars depending on claims)
 *   - signature (HMAC SHA-256 is 43 base64url chars, RS256 is 342+)
 * so total length is always >= 100 chars and the signature segment alone
 * is always >= 16 chars. We require:
 *   - first segment 8+ chars (header is always > this)
 *   - middle segment 8+ chars (payload always has at least one claim)
 *   - last segment 16+ chars (any signature, even unsigned `none` uses '' which
 *     wouldn't match the +-anchored class anyway, so 16 is a safe floor)
 * This excludes `0.5.6` (1-1-1) and `foo.bar.baz` (3-3-3) while still matching
 * any genuine JWT. False negatives are theoretically possible with a hand-
 * crafted toy JWT but in practice every real JWT clears these floors easily.
 */
const JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}$/;

/**
 * Anything over this length is redacted regardless of key. Page text
 * regularly exceeds this; legitimate diagnostic values (tab IDs, URLs,
 * messages) almost never do.
 */
const MAX_STRING_LEN = 200;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Recursively redact an arbitrary value. Returns a new structure that
 * is safe to log.
 *
 * Implementation note: depth-bounded. Anything deeper than 16 nesting
 * levels is replaced with `[deep-truncated]`. Stops mutual-recursion
 * disasters on circular references (though JSON.stringify would also
 * catch those — this is belt-and-suspenders).
 */
export function redact(value: unknown, depth: number = 0): unknown {
  if (depth > 16) return '[deep-truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    return redactObject(value as Record<string, unknown>, depth);
  }
  // function / symbol — not loggable. Replace with a marker.
  return `[${typeof value}]`;
}

/**
 * Apply shape-based redaction to a bare string (no key context).
 *
 * Three layers:
 *   1. JWT-shaped → fully redacted (length leaks fixed-size secrets)
 *   2. Whole-string URL → URL redaction
 *   3. Long string → length summary
 *   4. Contains embedded URLs → URLs redacted in place, rest preserved
 *      up to length cap
 */
function redactString(s: string): string {
  if (s.length === 0) return s;
  if (JWT_RE.test(s)) return '[REDACTED-JWT]';
  if (URL_RE.test(s)) return redactUrl(s);
  if (s.length > MAX_STRING_LEN) return `[len=${s.length}]`;
  // Substring URLs: redact in place. Lets short error messages like
  // "Connection to https://api.x.com/secret failed" become
  // "Connection to https://api.x.com/[redacted] failed".
  if (URL_SUBSTRING_RE.test(s)) {
    URL_SUBSTRING_RE.lastIndex = 0; // reset stateful regex
    return s.replace(URL_SUBSTRING_RE, (match) => redactUrl(match));
  }
  return s;
}

/**
 * Apply key-based + shape-based redaction to an object's fields.
 */
function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();

    if (SECRET_KEYS.has(key)) {
      out[k] = '[REDACTED-SECRET]';
      continue;
    }

    if (URL_KEYS.has(key)) {
      if (typeof v === 'string') {
        out[k] = redactUrl(v);
      } else {
        // Unusual: a `url` field whose value isn't a string. Recurse so
        // any nested URL strings inside (e.g. an array of URLs) get
        // redacted.
        out[k] = redact(v, depth + 1);
      }
      continue;
    }

    if (TEXT_KEYS.has(key)) {
      out[k] = lengthSummary(v);
      continue;
    }

    if (RECORD_ARRAY_KEYS.has(key)) {
      out[k] = recordArraySummary(v);
      continue;
    }

    if (RECURSE_KEYS.has(key)) {
      out[k] = redact(v, depth + 1);
      continue;
    }

    // Default: recurse so nested objects still get redacted, and apply
    // shape-based redaction to bare strings.
    out[k] = redact(v, depth + 1);
  }
  return out;
}

/**
 * Replace a URL with `<scheme>://<host>/[redacted]`. Preserves enough
 * to debug (scheme + host) without leaking path/query/fragment.
 */
export function redactUrl(s: string): string {
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    // Not a URL despite passing the regex (rare). Fall back to length.
    return `[len=${s.length}]`;
  }
}

/**
 * Replace any value with a length-only summary. Strings get their
 * length. Arrays/objects get their key/length counts.
 */
function lengthSummary(v: unknown): string {
  if (v === null || v === undefined) return `[empty]`;
  if (typeof v === 'string') return `[len=${v.length}]`;
  if (Array.isArray(v)) return `[arrayLen=${v.length}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return `[objKeys=${keys.length}]`;
  }
  return `[${typeof v}]`;
}

/**
 * Summarize an array of records: length + sample of keys from the first
 * entry. This tells the debugger "we got 73 rows, columns were name,
 * email, joined" without the row contents.
 */
function recordArraySummary(v: unknown): string | unknown {
  if (!Array.isArray(v)) {
    // Not actually an array — fall back to default handling.
    return redact(v);
  }
  if (v.length === 0) return '[arrayLen=0]';
  const first = v[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const keys = Object.keys(first as object).slice(0, 5);
    return `[arrayLen=${v.length}, sampleKeys=[${keys.join(', ')}]]`;
  }
  return `[arrayLen=${v.length}]`;
}

// ── Error redaction ───────────────────────────────────────────────────────

export interface RedactedError {
  errorName: string;
  errorMessage: string;
  errorCode?: string;
  stack?: string;
}

/**
 * Reduce an Error (or anything throw-able) into a logger-safe shape.
 * Keeps the class name and error code verbatim — those are short, our
 * own, and useful for grep. Redacts message and stack because they
 * often embed page-derived text.
 */
export function redactError(err: unknown): RedactedError {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return {
      errorName: err.name || 'Error',
      errorMessage: redactString(err.message ?? ''),
      ...(typeof code === 'string' ? { errorCode: code } : {}),
      ...(err.stack ? { stack: redactStack(err.stack) } : {}),
    };
  }
  if (typeof err === 'string') {
    return { errorName: 'StringError', errorMessage: redactString(err) };
  }
  if (err && typeof err === 'object') {
    // Plain object thrown (unusual but seen in extension dispatcher).
    const obj = err as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown };
    return {
      errorName: typeof obj.name === 'string' ? obj.name : 'ObjectError',
      errorMessage: redactString(typeof obj.message === 'string' ? obj.message : ''),
      ...(typeof obj.code === 'string' ? { errorCode: obj.code } : {}),
      ...(typeof obj.stack === 'string' ? { stack: redactStack(obj.stack) } : {}),
    };
  }
  return { errorName: 'UnknownError', errorMessage: `[${typeof err}]` };
}

/**
 * Stack traces embed file paths (fine to keep), function names (fine),
 * and sometimes inlined argument values (NOT fine). Redact URLs found
 * in each line, then cap to 20 lines.
 */
function redactStack(stack: string): string {
  const lines = stack.split('\n').slice(0, 20);
  const redacted = lines.map((line) => {
    URL_SUBSTRING_RE.lastIndex = 0;
    return line.replace(URL_SUBSTRING_RE, (match) => redactUrl(match));
  });
  return redacted.join('\n');
}
