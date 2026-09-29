/**
 * The live hub: who is connected, and how a message reaches them.
 *
 * The store is the durable record; the hub is the volatile "right now". It maps
 * each authenticated user to their open sockets (a user may have two tabs), and
 * knows how to deliver a server message to a specific user across all of them.
 *
 * It holds no game or chat logic - only routing. Deciding who should receive
 * what lives in server.ts, against the store's membership records.
 */

import type { ServerMessage } from '@copse/protocol';
import type { ServerWebSocket } from 'bun';

/** Per-socket state Bun carries for us on ws.data. */
export interface SocketData {
  userId: string;
  /** Rolling message counter for rate limiting. */
  rate: { count: number; until: number };
}

export class Hub {
  private sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();

  add(ws: ServerWebSocket<SocketData>): void {
    const set = this.sockets.get(ws.data.userId) ?? new Set();
    set.add(ws);
    this.sockets.set(ws.data.userId, set);
  }

  remove(ws: ServerWebSocket<SocketData>): void {
    const set = this.sockets.get(ws.data.userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.sockets.delete(ws.data.userId);
  }

  /** True if a user has at least one live socket. */
  isOnline(userId: string): boolean {
    return this.sockets.has(userId);
  }

  /** Deliver to every socket a user has open. A no-op if they are offline. */
  send(userId: string, msg: ServerMessage): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) ws.send(payload);
  }

  /** Deliver to several users at once - a conversation's members, typically. */
  sendMany(userIds: Iterable<string>, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const userId of userIds) {
      const set = this.sockets.get(userId);
      if (!set) continue;
      for (const ws of set) ws.send(payload);
    }
  }
}
