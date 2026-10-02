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
  /** The one room this socket is scoped to. Switching rooms reconnects. */
  roomId: string;
  /** Rolling message counter for rate limiting. */
  rate: { count: number; until: number };
}

/**
 * The hub is room-aware. Because a socket is scoped to a single room (a user may
 * hold several sockets, one per open room), every delivery names the room it is
 * for, and only sockets viewing that room receive it. That keeps one room's
 * directory and messages from ever leaking onto a socket viewing another.
 */
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

  /** Deliver to a user's sockets that are viewing `roomId`. No-op if none. */
  send(userId: string, roomId: string, msg: ServerMessage): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const ws of set) if (ws.data.roomId === roomId) ws.send(payload);
  }

  /**
   * Who has at least one live socket viewing `roomId`. This is the only source
   * of presence: it is the socket registry itself, so it cannot disagree with
   * reality, and a client has no way to claim to be online.
   */
  onlineIn(roomId: string): string[] {
    const ids: string[] = [];
    for (const [userId, set] of this.sockets) {
      for (const ws of set) {
        if (ws.data.roomId === roomId) {
          ids.push(userId);
          break;
        }
      }
    }
    return ids;
  }

  /** Deliver to several users' sockets that are viewing `roomId`. */
  sendMany(userIds: Iterable<string>, roomId: string, msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const userId of userIds) {
      const set = this.sockets.get(userId);
      if (!set) continue;
      for (const ws of set) if (ws.data.roomId === roomId) ws.send(payload);
    }
  }
}
