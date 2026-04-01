// Exponential backoff with jitter
// Max 5s — localhost connection, no server to protect from thundering herd
const INITIAL_BACKOFF = 1000;
const MULTIPLIER = 1.6;
const MAX_BACKOFF = 5000;
const JITTER = 0.2;

export function calculateBackoff(failureCount: number): number {
  const base = Math.min(INITIAL_BACKOFF * Math.pow(MULTIPLIER, failureCount), MAX_BACKOFF);
  const jitter = base * JITTER * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

// Backoff Timer Manager
export interface BackoffTimer {
  schedule(failureCount: number, callback: () => void): void;
  cancel(): void;
  getNextDelay(failureCount: number): number;
}

export function createBackoffTimer(): BackoffTimer {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(failureCount: number, callback: () => void): void {
      this.cancel();
      const delay = calculateBackoff(failureCount);
      timerId = setTimeout(callback, delay);
    },
    cancel(): void {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },
    getNextDelay(failureCount: number): number {
      return calculateBackoff(failureCount);
    },
  };
}
