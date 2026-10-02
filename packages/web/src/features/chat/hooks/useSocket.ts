/**
 * Owns the engine's lifecycle: start it once the account is unlocked, tear it
 * down when locked or signed out. Kept as a hook so the connection lives exactly
 * as long as a mounted, ready session - no more.
 *
 * The socket is scoped to one room, so before connecting we settle on which: the
 * room this session just joined (held in memory by the register flow), else the
 * room this account last had open, else its first room. The remembered one is
 * checked against the list the server just returned - a room you were removed
 * from must not keep pulling you back to a socket that will refuse it.
 */

import { useEffect } from 'react';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { startEngine, stopEngine } from '@/features/chat/engine.ts';
import { lastRoom } from '@/features/chat/place.ts';
import * as api from '@/lib/api.ts';

export function useSocket(): void {
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    (async () => {
      let roomId = useRoomStore.getState().currentRoomId;
      if (!roomId) {
        try {
          const rooms = await api.listRooms();
          if (cancelled) return;
          useRoomStore.getState().setRooms(rooms);
          const remembered = lastRoom(useAuth.getState().me?.id ?? '');
          roomId = (remembered && rooms.some((r) => r.id === remembered) ? remembered : rooms[0]?.id) ?? null;
          if (roomId) useRoomStore.getState().setCurrent(roomId);
        } catch {
          /* leave unstarted; a manual room pick or reload will retry */
        }
      }
      if (!cancelled && roomId) startEngine(roomId);
    })();
    return () => {
      cancelled = true;
      stopEngine();
    };
  }, [status]);
}
