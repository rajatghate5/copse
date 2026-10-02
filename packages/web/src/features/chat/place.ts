/**
 * Where you were: the room and the conversation this account last had open.
 *
 * A reload used to land on whichever room the REST list happened to return first
 * and on no conversation at all, so every refresh meant finding your place
 * again. This remembers it.
 *
 * Nothing secret goes in here. A room id and a conversation id are server-side
 * identifiers this account can already see; the contents stay sealed and are
 * nowhere near this file. Both ids are checked against the live lists from the
 * server before they are used, so one that was deleted, or that belongs to
 * another account on this browser, is ignored rather than trusted.
 *
 * localStorage rather than sessionStorage: a refresh would survive either, but
 * closing the tab and coming back tomorrow should still land where you were.
 * Keyed by user id, so two accounts sharing a browser do not inherit each
 * other's place.
 */

const key = (userId: string) => `copse.place.${userId}`;

interface Place {
  roomId: string | null;
  /** Last conversation per room, so switching back restores each room's thread. */
  convs: Record<string, string>;
}

const NOWHERE: Place = { roomId: null, convs: {} };

function read(userId: string): Place {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return NOWHERE;
    const v = JSON.parse(raw) as Partial<Place>;
    return {
      roomId: typeof v.roomId === 'string' ? v.roomId : null,
      // Anything that is not a string map is treated as absent, not as an error:
      // a bad value here should cost you your place and nothing more.
      convs: v.convs && typeof v.convs === 'object' ? (v.convs as Record<string, string>) : {},
    };
  } catch {
    return NOWHERE;
  }
}

function write(userId: string, place: Place): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(place));
  } catch {
    /* Private mode, or a full quota: lose the place, never the session. */
  }
}

export function lastRoom(userId: string): string | null {
  return read(userId).roomId;
}

export function lastConversation(userId: string, roomId: string): string | null {
  return read(userId).convs[roomId] ?? null;
}

export function rememberRoom(userId: string, roomId: string): void {
  const place = read(userId);
  if (place.roomId === roomId) return;
  write(userId, { ...place, roomId });
}

export function rememberConversation(userId: string, roomId: string, conversationId: string): void {
  const place = read(userId);
  if (place.roomId === roomId && place.convs[roomId] === conversationId) return;
  write(userId, { roomId, convs: { ...place.convs, [roomId]: conversationId } });
}

/** Signing out leaves nothing behind, including where the account had been. */
export function forgetPlace(userId: string): void {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}
