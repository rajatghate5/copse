/**
 * An avatar, optionally with a presence dot.
 *
 * Presence comes from the server's socket registry (`hub.onlineIn`), so the dot
 * means "has a live socket on this room right now" and nothing more — not "has
 * read anything", not "is at the keyboard". A direct chat shows the one peer's
 * state; a group shows a dot when any other member is on.
 *
 * The dot is never the only signal: it carries a `title`, so hovering says it in
 * words, and colour is not load-bearing for anyone who cannot see it.
 */

import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { initials } from '@/lib/format.ts';

export function Avatar({ name, size, userIds }: {
  name: string;
  size?: 'sm' | 'lg';
  /** Whose presence this avatar stands for. Empty or omitted shows no dot. */
  userIds?: string[];
}) {
  const online = useChatStore((s) => s.online);
  const present = (userIds ?? []).some((id) => online.includes(id));
  const cls = `av${size ? ` ${size}` : ''}`;

  if (!userIds || userIds.length === 0) return <span className={cls}>{initials(name)}</span>;

  return (
    <span className="av-wrap">
      <span className={cls}>{initials(name)}</span>
      {present && <span className="av-dot" title={userIds.length > 1 ? 'Someone is online' : 'Online'} />}
    </span>
  );
}
