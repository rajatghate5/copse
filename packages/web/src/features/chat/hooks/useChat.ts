/**
 * Per-conversation view model: the messages, and the actions that act on the
 * open conversation. Thin on purpose - the work lives in the engine; this hook
 * only binds it to the active id and keeps stable callbacks so the composer
 * doesn't re-render the message list.
 */

import { useCallback, useEffect } from 'react';
import { useChatStore, type ChatMessage } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { markRead, sendText, signalTyping } from '@/features/chat/engine.ts';
import type { Body } from '@/features/chat/body.ts';

const EMPTY: ChatMessage[] = [];

export function useChat(conversationId: string | null) {
  const messages = useChatStore((s) => (conversationId ? s.messages[conversationId] ?? EMPTY : EMPTY));

  const send = useCallback(
    (text: string, extra?: Omit<Body, 'text'>) => {
      const trimmed = text.trim();
      if (conversationId && trimmed) void sendText(conversationId, trimmed, extra);
    },
    [conversationId],
  );

  /**
   * Report the others' messages in the open conversation as read. Only while the
   * tab is actually visible - a thread open in a hidden tab has not been read by
   * anyone. The engine drops ids it has already reported, so this is safe to run
   * on every change.
   */
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const report = () => {
      if (document.visibilityState !== 'visible') return;
      const ids = messages.filter((m) => !m.mine).map((m) => m.id);
      if (ids.length > 0) markRead(conversationId, ids);
      // The same moment, locally: this thread is open and on screen, so nothing
      // in it is unread any more. Same condition as the receipt, deliberately -
      // the roster highlight and the other person's tick should agree.
      const meId = useAuth.getState().me?.id;
      const newest = messages[messages.length - 1]?.sentAt;
      if (meId && newest) useChatStore.getState().markSeen(meId, conversationId, newest);
    };
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [conversationId, messages]);

  const notifyTyping = useCallback(() => {
    if (conversationId) signalTyping(conversationId);
  }, [conversationId]);

  return { messages, send, notifyTyping };
}
