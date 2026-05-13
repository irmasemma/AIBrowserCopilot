/**
 * Single-flight bridge auto-start coordinator.
 *
 * Anyone who detects a missing/dead bridge (SW startup, alarm reconcile,
 * popup verify, or the explicit "Start Pilotwave service" button) calls
 * `tryStart()` here. Only one in-flight start at a time; rapid
 * re-entry within the cooldown returns the in-flight promise; max
 * `maxAutoAttempts` consecutive failures lock auto-restart until the
 * user explicitly clicks the start button (which calls `tryStart` with
 * `userInitiated: true`).
 *
 * This module is deliberately decoupled from the actual spawn — it
 * accepts an injected `attempt` function so tests can drive it without
 * Chrome native messaging. In production the attempt function is
 * `serviceDiscovery.startNativeHost()`.
 */

export interface CoordinatorAttempt {
  ok: boolean;
  alreadyRunning?: boolean;
  pid?: number;
  error?: string;
}

export interface CoordinatorOptions {
  attempt: () => Promise<CoordinatorAttempt>;
  cooldownMs?: number;
  maxAutoAttempts?: number;
  /** Replaces Date.now in tests. */
  now?: () => number;
}

export interface StartCoordinator {
  tryStart(options?: { userInitiated?: boolean }): Promise<CoordinatorAttempt>;
  reset(): void;
  /** Snapshot of the coordinator's internal state (for diagnostics). */
  getState(): {
    inFlight: boolean;
    consecutiveFailures: number;
    autoLocked: boolean;
    lastAttemptAt: number | null;
    lastResult: CoordinatorAttempt | null;
  };
}

const DEFAULT_COOLDOWN_MS = 10_000;
const DEFAULT_MAX_AUTO_ATTEMPTS = 3;

export function createStartCoordinator(opts: CoordinatorOptions): StartCoordinator {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxAutoAttempts = opts.maxAutoAttempts ?? DEFAULT_MAX_AUTO_ATTEMPTS;
  const now = opts.now ?? (() => Date.now());

  let inFlight: Promise<CoordinatorAttempt> | null = null;
  let lastAttemptAt: number | null = null;
  let lastResult: CoordinatorAttempt | null = null;
  let consecutiveFailures = 0;
  let autoLocked = false;

  async function runAttempt(userInitiated: boolean): Promise<CoordinatorAttempt> {
    lastAttemptAt = now();
    let result: CoordinatorAttempt;
    try {
      result = await opts.attempt();
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    lastResult = result;

    if (result.ok) {
      consecutiveFailures = 0;
      autoLocked = false;
    } else {
      consecutiveFailures += 1;
      if (!userInitiated && consecutiveFailures >= maxAutoAttempts) {
        autoLocked = true;
      }
    }
    return result;
  }

  return {
    async tryStart(options): Promise<CoordinatorAttempt> {
      const userInitiated = options?.userInitiated === true;

      if (inFlight) return inFlight;

      // User-initiated calls reset the auto-lock immediately.
      if (userInitiated) autoLocked = false;

      if (autoLocked && !userInitiated) {
        return {
          ok: false,
          error: 'auto_restart_locked',
        };
      }

      if (lastAttemptAt !== null && now() - lastAttemptAt < cooldownMs && !userInitiated) {
        return lastResult ?? { ok: false, error: 'cooldown_active' };
      }

      inFlight = runAttempt(userInitiated).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    reset(): void {
      consecutiveFailures = 0;
      autoLocked = false;
      lastAttemptAt = null;
      lastResult = null;
    },

    getState() {
      return {
        inFlight: inFlight !== null,
        consecutiveFailures,
        autoLocked,
        lastAttemptAt,
        lastResult,
      };
    },
  };
}
