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
      if (event.type === 'WS_OPEN')
        return { ...ctx, state: 'connected', failureCount: 0, missedHeartbeats: 0 };
      if (event.type === 'WS_ERROR' || event.type === 'TIMEOUT' || event.type === 'WS_CLOSE')
        return toReconnecting(ctx, { failureCount: ctx.failureCount + 1 });
      return ctx;

    case 'connected':
      if (event.type === 'HEARTBEAT_OK')
        return { ...ctx, missedHeartbeats: 0 };
      if (event.type === 'HEARTBEAT_MISS') {
        const missed = ctx.missedHeartbeats + 1;
        return missed >= 1
          ? { ...ctx, state: 'degraded', missedHeartbeats: missed }
          : { ...ctx, missedHeartbeats: missed };
      }
      if (event.type === 'WS_CLOSE')
        return toReconnecting(ctx);
      if (event.type === 'DISCONNECT')
        return { ...ctx, state: 'disconnected' };
      return ctx;

    case 'degraded':
      if (event.type === 'HEARTBEAT_OK')
        return { ...ctx, state: 'connected', missedHeartbeats: 0 };
      if (event.type === 'HEARTBEAT_MISS') {
        const missed = ctx.missedHeartbeats + 1;
        return missed >= 2
          ? toReconnecting(ctx, { missedHeartbeats: 0 })
          : { ...ctx, missedHeartbeats: missed };
      }
      if (event.type === 'WS_CLOSE')
        return toReconnecting(ctx);
      return ctx;

    case 'reconnecting':
      if (event.type === 'BACKOFF_EXPIRED')
        return { ...ctx, state: 'connecting' };
      if (event.type === 'DISCONNECT')
        return { ...ctx, state: 'disconnected' };
      return ctx;
  }
}
