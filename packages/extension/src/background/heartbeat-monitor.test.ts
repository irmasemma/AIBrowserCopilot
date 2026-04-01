import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHeartbeatMonitor, DEFAULT_HEARTBEAT_CONFIG } from './heartbeat-monitor';
import type { HeartbeatCallbacks, HeartbeatConfig } from './heartbeat-monitor';

describe('HeartbeatMonitor', () => {
  let callbacks: HeartbeatCallbacks;
  let config: HeartbeatConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    callbacks = {
      sendPing: vi.fn(),
      onMiss: vi.fn(),
      onDead: vi.fn(),
      onPongReceived: vi.fn(),
    };
    config = { ...DEFAULT_HEARTBEAT_CONFIG };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start/stop', () => {
    it('start() sets isRunning to true', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();
      expect(monitor.isRunning()).toBe(true);
      monitor.stop();
    });

    it('stop() sets isRunning to false', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();
      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });

    it('stop() clears interval timer', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();
      monitor.stop();
      // Advance time well past interval — sendPing should not be called
      vi.advanceTimersByTime(config.intervalMs * 5);
      expect(callbacks.sendPing).not.toHaveBeenCalled();
    });

    it('start() after start() resets state (idempotent)', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Trigger one ping and miss it
      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(1);

      // Advance again so miss is detected
      vi.advanceTimersByTime(config.intervalMs);
      expect(monitor.getMissedCount()).toBe(1);

      // Restart — should reset
      monitor.start();
      expect(monitor.getMissedCount()).toBe(0);
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
    });
  });

  describe('ping sending', () => {
    it('sendPing callback is called after intervalMs', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('sendPing is called repeatedly at intervalMs intervals', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Respond to each ping so they keep firing without miss logic
      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(1);
      monitor.receivePong(Date.now() - 50);

      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(2);
      monitor.receivePong(Date.now() - 50);

      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(3);

      monitor.stop();
    });
  });

  describe('pong received (happy path)', () => {
    it('receivePong resets missedCount to 0', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // First ping
      vi.advanceTimersByTime(config.intervalMs);
      // Miss it — second interval detects the miss
      vi.advanceTimersByTime(config.intervalMs);
      expect(monitor.getMissedCount()).toBe(1);

      // Now receive a pong
      monitor.receivePong(Date.now() - 100);
      expect(monitor.getMissedCount()).toBe(0);

      monitor.stop();
    });

    it('receivePong calculates latency correctly', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      vi.advanceTimersByTime(config.intervalMs);
      const sentTime = Date.now() - 150;
      monitor.receivePong(sentTime);

      expect(monitor.getLastLatency()).toBe(150);

      monitor.stop();
    });

    it('receivePong calls onPongReceived with latency', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      vi.advanceTimersByTime(config.intervalMs);
      const sentTime = Date.now() - 200;
      monitor.receivePong(sentTime);

      expect(callbacks.onPongReceived).toHaveBeenCalledWith(200);

      monitor.stop();
    });

    it('after receivePong, pendingPong is false so next interval sends fresh ping', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // First ping
      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(1);

      // Receive pong
      monitor.receivePong(Date.now() - 50);

      // Next interval should send ping without triggering onMiss
      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.sendPing).toHaveBeenCalledTimes(2);
      expect(callbacks.onMiss).not.toHaveBeenCalled();

      monitor.stop();
    });
  });

  describe('missed heartbeat', () => {
    it('if pong not received before next interval, onMiss is called', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // First ping fires
      vi.advanceTimersByTime(config.intervalMs);
      // Don't send pong — next interval detects miss
      vi.advanceTimersByTime(config.intervalMs);

      expect(callbacks.onMiss).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('missedCount increments on each miss', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      vi.advanceTimersByTime(config.intervalMs); // ping 1
      vi.advanceTimersByTime(config.intervalMs); // miss 1
      expect(monitor.getMissedCount()).toBe(1);

      vi.advanceTimersByTime(config.intervalMs); // miss 2
      expect(monitor.getMissedCount()).toBe(2);

      monitor.stop();
    });

    it('getMissedCount returns current miss count', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      expect(monitor.getMissedCount()).toBe(0);

      monitor.start();
      vi.advanceTimersByTime(config.intervalMs); // ping
      vi.advanceTimersByTime(config.intervalMs); // miss 1
      expect(monitor.getMissedCount()).toBe(1);

      monitor.stop();
    });
  });

  describe('dead connection', () => {
    it('after maxMissed consecutive misses, onDead is called', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Advance through all intervals: 1 ping + maxMissed misses
      for (let i = 0; i <= config.maxMissed; i++) {
        vi.advanceTimersByTime(config.intervalMs);
      }

      expect(callbacks.onDead).toHaveBeenCalledTimes(1);
    });

    it('after onDead, monitor stops (isRunning false)', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      for (let i = 0; i <= config.maxMissed; i++) {
        vi.advanceTimersByTime(config.intervalMs);
      }

      expect(monitor.isRunning()).toBe(false);
    });

    it('onDead is called exactly once (not on every subsequent tick)', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Go well past the dead threshold
      for (let i = 0; i < config.maxMissed + 5; i++) {
        vi.advanceTimersByTime(config.intervalMs);
      }

      expect(callbacks.onDead).toHaveBeenCalledTimes(1);
    });
  });

  describe('recovery', () => {
    it('if pong received after 1-2 misses but before maxMissed, missedCount resets', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Ping fires
      vi.advanceTimersByTime(config.intervalMs);
      // Miss 1
      vi.advanceTimersByTime(config.intervalMs);
      expect(monitor.getMissedCount()).toBe(1);
      // Miss 2
      vi.advanceTimersByTime(config.intervalMs);
      expect(monitor.getMissedCount()).toBe(2);

      // Recover
      monitor.receivePong(Date.now() - 100);
      expect(monitor.getMissedCount()).toBe(0);

      monitor.stop();
    });

    it('monitor continues normally after recovery', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      // Ping + 2 misses
      vi.advanceTimersByTime(config.intervalMs);
      vi.advanceTimersByTime(config.intervalMs);
      vi.advanceTimersByTime(config.intervalMs);
      expect(monitor.getMissedCount()).toBe(2);

      // Recover
      monitor.receivePong(Date.now() - 100);

      // Next interval should send fresh ping without miss
      vi.advanceTimersByTime(config.intervalMs);
      expect(callbacks.onMiss).not.toHaveBeenCalledTimes(3);
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
    });
  });

  describe('edge cases', () => {
    it('receivePong when not running is a no-op', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);

      // Should not throw or change state
      monitor.receivePong(Date.now() - 100);
      expect(monitor.getLastLatency()).toBeNull();
      expect(callbacks.onPongReceived).not.toHaveBeenCalled();
    });

    it('stop() when not running is a no-op', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);

      // Should not throw
      expect(() => monitor.stop()).not.toThrow();
      expect(monitor.isRunning()).toBe(false);
    });

    it('multiple rapid receivePong calls do not cause issues', () => {
      const monitor = createHeartbeatMonitor(config, callbacks);
      monitor.start();

      vi.advanceTimersByTime(config.intervalMs);

      // Rapid pongs
      monitor.receivePong(Date.now() - 100);
      monitor.receivePong(Date.now() - 50);
      monitor.receivePong(Date.now() - 25);

      expect(monitor.getMissedCount()).toBe(0);
      expect(monitor.getLastLatency()).toBe(25);
      expect(callbacks.onPongReceived).toHaveBeenCalledTimes(3);

      monitor.stop();
    });
  });

  describe('DEFAULT_HEARTBEAT_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_HEARTBEAT_CONFIG.intervalMs).toBe(20_000);
      expect(DEFAULT_HEARTBEAT_CONFIG.timeoutMs).toBe(5_000);
      expect(DEFAULT_HEARTBEAT_CONFIG.maxMissed).toBe(3);
    });
  });
});
