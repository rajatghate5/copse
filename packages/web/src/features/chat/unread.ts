/**
 * What you have already seen, per conversation.
 *
 * The roster had no notion of unread at all: every conversation looked the same
 * whether or not something had arrived in it. Unread is a per-device idea -
 * "messages that have appeared since I last looked at this thread" - so it is
 * kept here rather than on the server, which only knows that *somebody* read a
 * message and deliberately not who.
 *
 * One timestamp per conversation, not a set of message ids: it is a watermark,
 * so it stays small however long the thread gets, and anything newer than it
 * from someone else is unread. localStorage, keyed by user id, for the same
 * reasons as [[place.ts]] - a refresh must not mark everything unread again, and
 * two accounts in one browser must not share a watermark.
 */

const key = (userId: string) => `copse.seen.${userId}`;

export type Watermarks = Record<string, number>;

export function loadSeen(userId: string): Watermarks {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Keep only what this is meant to hold, so a hand-edited or half-written
    // value costs you a highlight rather than throwing on every render.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === 'number'),
    ) as Watermarks;
  } catch {
    return {};
  }
}

export function saveSeen(userId: string, marks: Watermarks): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(marks));
  } catch {
    /* Private mode or a full quota: lose the watermark, never the session. */
  }
}

export function forgetSeen(userId: string): void {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}

/** How many messages in this thread arrived from someone else since you looked. */
export function unreadCount(
  messages: { mine: boolean; sentAt: number }[] | undefined,
  seenAt: number | undefined,
): number {
  if (!messages || messages.length === 0) return 0;
  const since = seenAt ?? 0;
  let n = 0;
  for (const m of messages) if (!m.mine && m.sentAt > since) n += 1;
  return n;
}
