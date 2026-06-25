import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getBrowserInstanceId } from '../shared/browser-instance-id.js';
import { extractApiStateFacts, type ApiStateFacts, type ApiStatePayload } from './connection-verdict.js';

/**
 * Polls the bridge's `/api/state` and extracts the truthful-status facts for OUR
 * browserId (liveness, supersededCount, recent request success/failure). This is
 * the data `deriveHeader`/`buildSteps` used to FETCH then DISCARD — now consumed.
 *
 * Returns null facts when the bridge is unreachable or our browserId isn't present
 * (in which case the verdict falls back to the client-side ConnectionContext).
 */
export interface UseApiStateResult {
  facts: ApiStateFacts | null;
  /** Run an on-demand synthetic tool-path check (a real `list_tabs` via the same
   *  dispatch path MCP uses). Resolves true on success. Flips `quickCheckPassed`. */
  runQuickCheck: () => Promise<boolean>;
  /** True once a quick check has succeeded this session — proves "Working". */
  quickCheckPassed: boolean;
  /** Force an immediate /api/state refresh. */
  refresh: () => void;
}

export function useApiState(port: number | undefined, isHealthy: boolean): UseApiStateResult {
  const [facts, setFacts] = useState<ApiStateFacts | null>(null);
  const [quickCheckPassed, setQuickCheckPassed] = useState(false);
  const [tick, setTick] = useState(0);
  const browserIdRef = useRef<string | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    const pull = async (): Promise<void> => {
      if (!port) {
        if (!cancelled) setFacts(null);
        return;
      }
      try {
        if (browserIdRef.current === null) {
          browserIdRef.current = await getBrowserInstanceId();
        }
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3_000);
        let res: Response;
        try {
          res = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: ctrl.signal });
        } finally {
          clearTimeout(t);
        }
        if (!res.ok) {
          if (!cancelled) setFacts(null);
          return;
        }
        const payload = (await res.json()) as ApiStatePayload;
        const next = extractApiStateFacts(payload, browserIdRef.current, Date.now());
        if (!cancelled) setFacts(next);
      } catch {
        // Bridge unreachable / parse error → no facts; verdict uses ctx fallback.
        if (!cancelled) setFacts(null);
      }
    };

    void pull();
    // Poll fast while broken (converge quickly on flapping/recovering), slower
    // while healthy (the supersede counter only matters during a storm).
    const intervalMs = isHealthy ? 5_000 : 2_500;
    const interval = setInterval(() => void pull(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [port, isHealthy, tick]);

  const runQuickCheck = useCallback(async (): Promise<boolean> => {
    try {
      // Dispatch a real `list_tabs` through the SAME handler MCP tool calls use
      // (background.ts `dispatch_tool`). A success is a genuine tool-path fact,
      // not a heartbeat — exactly what "Working" must bind to.
      const res = (await chrome.runtime.sendMessage({
        type: 'dispatch_tool',
        name: 'list_tabs',
        params: {},
      })) as { ok?: boolean } | undefined;
      const ok = res?.ok === true;
      setQuickCheckPassed(ok);
      return ok;
    } catch {
      return false;
    }
  }, []);

  return { facts, runQuickCheck, quickCheckPassed, refresh };
}
