import type { ConnectionContext, ConnectionState } from '../shared/types';

export type ConnectionEvent =
  | { type: 'CONNECT' }
  | { type: 'AUTO_CONNECT' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_ERROR' }
  | { type: 'WS_CLOSE' }
  | { type: 'TIMEOUT' }
  | { type: 'HEARTBEAT_OK' }
  | { type: 'HEARTBEAT_MISS' }
  | { type: 'DISCONNECT' }
  | { type: 'BACKOFF_EXPIRED' };

export function createInitialContext(): ConnectionContext {
  return {
    state: 'disconnected',
    failureCount: 0,
    missedHeartbeats: 0,
    lastConnectedAt: null,
    serverInfo: null,
    error: null,
    reconnectsThisSession: 0,
    diagnosticReason: null,
    lastVerifiedAt: 0,
    versionStatus: null,
  };
}

function toReconnecting(ctx: ConnectionContext, patch?: Partial<ConnectionContext>): ConnectionContext {
  return { ...ctx, state: 'reconnecting' as ConnectionState, reconnectsThisSession: ctx.reconnectsThisSession + 1, ...patch };
}

export function transition(ctx: ConnectionContext, event: ConnectionEvent): ConnectionContext {
  switch (ctx.state) {
    case 'disconnected':
      if (event.type === 'CONNECT' || event.type === 'AUTO_CONNECT')
        return { ...ctx, state: 'connecting', error: null };
      return ctx;

    case 'connecting':
      // §6.1 backoff amplifier fix: WS_OPEN (and server_info) no longer reset
      // failureCount — a connection that opens but dies within seconds must
      // still count as a failure so backoff climbs to its cap. failureCount is
      // reset only once the connection is STABLE (first HEARTBEAT_OK = survived
      // ≥ one heartbeat interval), handled in the 'connected' case below.
      if (event.type === 'WS_OPEN')
        return { ...ctx, state: 'connected', missedHeartbeats: 0 };
      if (event.type === 'WS_ERROR' || event.type === 'TIMEOUT' || event.type === 'WS_CLOSE')
        return toReconnecting(ctx, { failureCount: ctx.failureCount + 1 });
      return ctx;

    case 'connected':
      if (event.type === 'HEARTBEAT_OK')
        // First pong proves the connection survived ≥ one heartbeat interval →
        // it is genuinely stable; safe to reset the backoff failure counter.
        return { ...ctx, missedHeartbeats: 0, failureCount: 0 };
      if (event.type === 'HEARTBEAT_MISS') {
        const missed = ctx.missedHeartbeats + 1;
        return missed >= 1
          ? { ...ctx, state: 'degraded', missedHeartbeats: missed }
          : { ...ctx, missedHeartbeats: missed };
      }
      if (event.type === 'WS_CLOSE')
        // A close from connected before stability (failureCount still >0, no
        // HEARTBEAT_OK yet) must count toward backoff. After stability
        // failureCount is 0, so this increments from 0 → 1 for the next cycle,
        // which is correct: a freshly-dropped stable link gets one retry at the
        // floor, then climbs if it keeps dropping.
        return toReconnecting(ctx, { failureCount: ctx.failureCount + 1 });
      if (event.type === 'DISCONNECT')
        return { ...ctx, state: 'disconnected' };
      return ctx;

    case 'degraded':
      if (event.type === 'HEARTBEAT_OK')
        return { ...ctx, state: 'connected', missedHeartbeats: 0, failureCount: 0 };
      if (event.type === 'HEARTBEAT_MISS') {
        const missed = ctx.missedHeartbeats + 1;
        return missed >= 2
          ? toReconnecting(ctx, { missedHeartbeats: 0, failureCount: ctx.failureCount + 1 })
          : { ...ctx, missedHeartbeats: missed };
      }
      if (event.type === 'WS_CLOSE')
        return toReconnecting(ctx, { failureCount: ctx.failureCount + 1 });
      return ctx;

    case 'reconnecting':
      if (event.type === 'BACKOFF_EXPIRED' || event.type === 'CONNECT' || event.type === 'AUTO_CONNECT')
        return { ...ctx, state: 'connecting' };
      // Failsafe: a server_info-driven WS_OPEN can arrive while we're still in
      // reconnecting (e.g. reconcile() opened a relay without dispatching
      // BACKOFF_EXPIRED first). Accept the connection rather than getting stuck.
      // Do NOT reset failureCount here (§6.1): stability is proven by the first
      // HEARTBEAT_OK, not by the socket opening.
      if (event.type === 'WS_OPEN')
        return { ...ctx, state: 'connected', missedHeartbeats: 0 };
      if (event.type === 'DISCONNECT')
        return { ...ctx, state: 'disconnected' };
      return ctx;
  }
}
