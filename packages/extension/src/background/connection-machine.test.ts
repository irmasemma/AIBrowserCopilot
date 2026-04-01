import { describe, it, expect } from 'vitest';
import { createInitialContext, transition, ConnectionEvent } from './connection-machine';
import type { ConnectionContext } from '../shared/types';

function ctx(overrides: Partial<ConnectionContext> = {}): ConnectionContext {
  return { ...createInitialContext(), ...overrides };
}

describe('createInitialContext', () => {
  it('returns correct defaults', () => {
    const c = createInitialContext();
    expect(c.state).toBe('disconnected');
    expect(c.failureCount).toBe(0);
    expect(c.missedHeartbeats).toBe(0);
    expect(c.lastConnectedAt).toBeNull();
    expect(c.serverInfo).toBeNull();
    expect(c.error).toBeNull();
    expect(c.reconnectsThisSession).toBe(0);
  });
});

describe('disconnected', () => {
  it('CONNECT -> connecting, clears error', () => {
    const result = transition(ctx({ error: 'old error' }), { type: 'CONNECT' });
    expect(result.state).toBe('connecting');
    expect(result.error).toBeNull();
  });

  it('AUTO_CONNECT -> connecting, clears error', () => {
    const result = transition(ctx({ error: 'old' }), { type: 'AUTO_CONNECT' });
    expect(result.state).toBe('connecting');
    expect(result.error).toBeNull();
  });

  it('ignores invalid events', () => {
    const c = ctx();
    const events: ConnectionEvent['type'][] = ['WS_OPEN', 'WS_ERROR', 'WS_CLOSE', 'HEARTBEAT_OK', 'HEARTBEAT_MISS', 'TIMEOUT', 'BACKOFF_EXPIRED'];
    for (const type of events) {
      expect(transition(c, { type } as ConnectionEvent)).toBe(c);
    }
  });
});

describe('connecting', () => {
  const base = ctx({ state: 'connecting' });

  it('WS_OPEN -> connected, resets failureCount and missedHeartbeats', () => {
    const c = ctx({ state: 'connecting', failureCount: 3, missedHeartbeats: 2 });
    const result = transition(c, { type: 'WS_OPEN' });
    expect(result.state).toBe('connected');
    expect(result.failureCount).toBe(0);
    expect(result.missedHeartbeats).toBe(0);
  });

  it('WS_ERROR -> reconnecting, increments failureCount', () => {
    const result = transition(base, { type: 'WS_ERROR' });
    expect(result.state).toBe('reconnecting');
    expect(result.failureCount).toBe(1);
  });

  it('TIMEOUT -> reconnecting, increments failureCount', () => {
    const c = ctx({ state: 'connecting', failureCount: 2 });
    const result = transition(c, { type: 'TIMEOUT' });
    expect(result.state).toBe('reconnecting');
    expect(result.failureCount).toBe(3);
  });

  it('WS_ERROR increments reconnectsThisSession', () => {
    const result = transition(base, { type: 'WS_ERROR' });
    expect(result.reconnectsThisSession).toBe(1);
  });

  it('ignores invalid events', () => {
    const events: ConnectionEvent['type'][] = ['CONNECT', 'DISCONNECT', 'HEARTBEAT_OK'];
    for (const type of events) {
      expect(transition(base, { type } as ConnectionEvent)).toBe(base);
    }
  });
});

describe('connected', () => {
  const base = ctx({ state: 'connected' });

  it('HEARTBEAT_OK -> connected, resets missedHeartbeats', () => {
    const c = ctx({ state: 'connected', missedHeartbeats: 0 });
    const result = transition(c, { type: 'HEARTBEAT_OK' });
    expect(result.state).toBe('connected');
    expect(result.missedHeartbeats).toBe(0);
  });

  it('HEARTBEAT_MISS -> degraded when missedHeartbeats reaches 1', () => {
    const result = transition(base, { type: 'HEARTBEAT_MISS' });
    expect(result.state).toBe('degraded');
    expect(result.missedHeartbeats).toBe(1);
  });

  it('WS_CLOSE -> reconnecting', () => {
    const result = transition(base, { type: 'WS_CLOSE' });
    expect(result.state).toBe('reconnecting');
  });

  it('WS_CLOSE increments reconnectsThisSession', () => {
    const result = transition(base, { type: 'WS_CLOSE' });
    expect(result.reconnectsThisSession).toBe(1);
  });

  it('DISCONNECT -> disconnected', () => {
    const result = transition(base, { type: 'DISCONNECT' });
    expect(result.state).toBe('disconnected');
  });

  it('ignores invalid events', () => {
    const events: ConnectionEvent['type'][] = ['CONNECT', 'WS_OPEN', 'BACKOFF_EXPIRED'];
    for (const type of events) {
      expect(transition(base, { type } as ConnectionEvent)).toBe(base);
    }
  });
});

describe('degraded', () => {
  const base = ctx({ state: 'degraded', missedHeartbeats: 1 });

  it('HEARTBEAT_OK -> connected, resets missedHeartbeats', () => {
    const result = transition(base, { type: 'HEARTBEAT_OK' });
    expect(result.state).toBe('connected');
    expect(result.missedHeartbeats).toBe(0);
  });

  it('HEARTBEAT_MISS stays degraded when missedHeartbeats < 2', () => {
    const c = ctx({ state: 'degraded', missedHeartbeats: 0 });
    const result = transition(c, { type: 'HEARTBEAT_MISS' });
    expect(result.state).toBe('degraded');
    expect(result.missedHeartbeats).toBe(1);
  });

  it('HEARTBEAT_MISS -> reconnecting when missedHeartbeats reaches 2', () => {
    const result = transition(base, { type: 'HEARTBEAT_MISS' });
    expect(result.state).toBe('reconnecting');
    expect(result.missedHeartbeats).toBe(0);
    expect(result.reconnectsThisSession).toBe(1);
  });

  it('WS_CLOSE -> reconnecting', () => {
    const result = transition(base, { type: 'WS_CLOSE' });
    expect(result.state).toBe('reconnecting');
  });

  it('ignores invalid events', () => {
    const events: ConnectionEvent['type'][] = ['CONNECT', 'WS_OPEN', 'DISCONNECT'];
    for (const type of events) {
      expect(transition(base, { type } as ConnectionEvent)).toBe(base);
    }
  });
});

describe('reconnecting', () => {
  const base = ctx({ state: 'reconnecting', failureCount: 2, reconnectsThisSession: 1 });

  it('BACKOFF_EXPIRED -> connecting', () => {
    const result = transition(base, { type: 'BACKOFF_EXPIRED' });
    expect(result.state).toBe('connecting');
  });

  it('DISCONNECT -> disconnected', () => {
    const result = transition(base, { type: 'DISCONNECT' });
    expect(result.state).toBe('disconnected');
  });

  it('ignores invalid events', () => {
    const events: ConnectionEvent['type'][] = ['WS_OPEN', 'HEARTBEAT_OK', 'CONNECT'];
    for (const type of events) {
      expect(transition(base, { type } as ConnectionEvent)).toBe(base);
    }
  });
});

describe('multi-step scenarios', () => {
  it('failureCount increments through multiple WS_ERROR events', () => {
    let c = ctx({ state: 'connecting' });
    c = transition(c, { type: 'WS_ERROR' }); // -> reconnecting, failureCount=1
    expect(c.failureCount).toBe(1);
    c = transition(c, { type: 'BACKOFF_EXPIRED' }); // -> connecting
    c = transition(c, { type: 'WS_ERROR' }); // -> reconnecting, failureCount=2
    expect(c.failureCount).toBe(2);
    c = transition(c, { type: 'BACKOFF_EXPIRED' });
    c = transition(c, { type: 'TIMEOUT' }); // -> reconnecting, failureCount=3
    expect(c.failureCount).toBe(3);
  });

  it('missedHeartbeats increments through HEARTBEAT_MISS events', () => {
    let c = ctx({ state: 'connected' });
    c = transition(c, { type: 'HEARTBEAT_MISS' }); // missed=1, -> degraded
    expect(c.state).toBe('degraded');
    expect(c.missedHeartbeats).toBe(1);
    c = transition(c, { type: 'HEARTBEAT_MISS' }); // missed=2, -> reconnecting, reset to 0
    expect(c.state).toBe('reconnecting');
    expect(c.missedHeartbeats).toBe(0);
  });

  it('reconnectsThisSession accumulates across multiple reconnect entries', () => {
    let c = ctx({ state: 'connected' });
    c = transition(c, { type: 'WS_CLOSE' }); // -> reconnecting (1)
    expect(c.reconnectsThisSession).toBe(1);
    c = transition(c, { type: 'BACKOFF_EXPIRED' }); // -> connecting
    c = transition(c, { type: 'WS_OPEN' }); // -> connected
    c = transition(c, { type: 'WS_CLOSE' }); // -> reconnecting (2)
    expect(c.reconnectsThisSession).toBe(2);
    c = transition(c, { type: 'BACKOFF_EXPIRED' });
    c = transition(c, { type: 'WS_ERROR' }); // -> reconnecting (3)
    expect(c.reconnectsThisSession).toBe(3);
  });

  it('full lifecycle: disconnect -> connect -> degrade -> recover -> disconnect', () => {
    let c = createInitialContext();
    c = transition(c, { type: 'CONNECT' });
    expect(c.state).toBe('connecting');
    c = transition(c, { type: 'WS_OPEN' });
    expect(c.state).toBe('connected');
    c = transition(c, { type: 'HEARTBEAT_MISS' });
    expect(c.state).toBe('degraded');
    c = transition(c, { type: 'HEARTBEAT_OK' });
    expect(c.state).toBe('connected');
    c = transition(c, { type: 'DISCONNECT' });
    expect(c.state).toBe('disconnected');
  });
});
