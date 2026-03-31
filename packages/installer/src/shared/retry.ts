export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff.
 * Delay doubles each attempt: baseDelayMs, baseDelayMs*2, baseDelayMs*4, ...
 * Capped at maxDelayMs. Adds ±20% jitter to prevent thundering herd.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === opts.maxAttempts) break;

      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const cappedDelay = Math.min(exponentialDelay, opts.maxDelayMs);
      // Add ±20% jitter
      const jitter = cappedDelay * (0.8 + Math.random() * 0.4);
      const delayMs = Math.round(jitter);

      opts.onRetry?.(attempt, lastError, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError;
};
