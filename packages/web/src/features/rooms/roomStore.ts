/**
 * Room state, in Zustand. A member may belong to a few rooms; exactly one is
 * "current" at a time, and the socket is scoped to it. Switching the current room
 * reconnects the socket (see the engine), because a room is a sealed world with
 * its own directory and conversations.
 *
 * Nothing here is persisted: on load the app defaults to the first room (or, right
 * after signup, the room just joined, which the register flow sets in memory).
 */

import { create } from 'zustand';
import type { RoomSummary } from '@copse/protocol';

interface RoomState {
  rooms: RoomSummary[];
  currentRoomId: string | null;

  setRooms: (rooms: RoomSummary[]) => void;
  setCurrent: (id: string) => void;
  upsertRoom: (room: RoomSummary) => void;
  reset: () => void;
  /** The current room object, or null before one is chosen. */
  current: () => RoomSummary | null;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  currentRoomId: null,

  setRooms: (rooms) => set({ rooms }),
  setCurrent: (currentRoomId) => set({ currentRoomId }),
  upsertRoom: (room) =>
    set((s) => {
      const has = s.rooms.some((r) => r.id === room.id);
      return { rooms: has ? s.rooms.map((r) => (r.id === room.id ? room : r)) : [...s.rooms, room] };
    }),
  reset: () => set({ rooms: [], currentRoomId: null }),
  current: () => {
    const { rooms, currentRoomId } = get();
    return rooms.find((r) => r.id === currentRoomId) ?? null;
  },
}));
