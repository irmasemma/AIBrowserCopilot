export interface HeartbeatConfig {
  intervalMs: number; // 20000 (20 seconds)
  timeoutMs: number; // 5000 (5 seconds)
  maxMissed: number; // 3
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 20_000,
  timeoutMs: 5_000,
  maxMissed: 3,
};

export interface HeartbeatCallbacks {
  sendPing: () => void; // Called to send ping over WebSocket
  onMiss: () => void; // Called on each missed pong (triggers HEARTBEAT_MISS)
  onDead: () => void; // Called when maxMissed reached (triggers reconnecting)
  onPongReceived?: (latencyMs: number) => void; // Optional latency tracking
}

export interface HeartbeatMonitor {
  start(): void;
  stop(): void;
  receivePong(sentTimestamp: number): void;
  isRunning(): boolean;
  getMissedCount(): number;
  getLastLatency(): number | null;
}

export function createHeartbeatMonitor(
  config: HeartbeatConfig,
  callbacks: HeartbeatCallbacks,
): HeartbeatMonitor {
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let pendingPong = false;
  let missedCount = 0;
  let lastLatency: number | null = null;
  let running = false;

  function stop(): void {
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
    pendingPong = false;
    missedCount = 0;
    running = false;
  }

  function start(): void {
    stop(); // Clear any existing
    running = true;

    intervalTimer = setInterval(() => {
      if (pendingPong) {
        // Previous ping didn't get a pong
        missedCount++;
        if (missedCount >= config.maxMissed) {
          stop();
          callbacks.onDead();
          return;
        }
        callbacks.onMiss();
      }

      pendingPong = true;
      callbacks.sendPing();
    }, config.intervalMs);
  }

  function receivePong(sentTimestamp: number): void {
    if (!running) return;
    pendingPong = false;
    missedCount = 0;
    lastLatency = Date.now() - sentTimestamp;
    callbacks.onPongReceived?.(lastLatency);
  }

  return {
    start,
    stop,
    receivePong,
    isRunning: () => running,
    getMissedCount: () => missedCount,
    getLastLatency: () => lastLatency,
  };
}
