/**
 * Put the unread total in the tab title.
 *
 * The roster badge only helps if Copse is the tab you are looking at, and the
 * common case for an unread message is that it is not. A notification covers
 * that moment; the title covers every moment after it, which is what someone
 * scanning their tabs actually reads.
 *
 * The open thread is excluded while the tab is visible, for the same reason the
 * roster excludes it: you are reading it.
 */

import { useEffect } from 'react';
import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { unreadCount } from '@/features/chat/unread.ts';

const BASE = 'Copse';

export function useUnreadTitle(): void {
  const messages = useChatStore((s) => s.messages);
  const seen = useChatStore((s) => s.seen);
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);

  useEffect(() => {
    let total = 0;
    for (const id of Object.keys(conversations)) {
      if (id === activeId && document.visibilityState === 'visible') continue;
      total += unreadCount(messages[id], seen[id]);
    }
    document.title = total > 0 ? `(${total > 9 ? '9+' : total}) ${BASE}` : BASE;
    return () => { document.title = BASE; };
  }, [messages, seen, activeId, conversations]);
}
