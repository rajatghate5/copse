/**
 * Per-conversation view model: the messages, and the actions that act on the
 * open conversation. Thin on purpose - the work lives in the engine; this hook
 * only binds it to the active id and keeps stable callbacks so the composer
 * doesn't re-render the message list.
 */

import { useCallback } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore.ts';
import { sendText, signalTyping } from '../engine.ts';

const EMPTY: ChatMessage[] = [];

export function useChat(conversationId: string | null) {
  const messages = useChatStore((s) => (conversationId ? s.messages[conversationId] ?? EMPTY : EMPTY));

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (conversationId && trimmed) void sendText(conversationId, trimmed);
    },
    [conversationId],
  );

  const notifyTyping = useCallback(() => {
    if (conversationId) signalTyping(conversationId);
  }, [conversationId]);

  return { messages, send, notifyTyping };
}
