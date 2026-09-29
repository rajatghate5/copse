/**
 * Who, other than me, is typing in a conversation - resolved to display names.
 * The typing flags themselves are volatile realtime state in the chat store;
 * this hook just projects them for the active conversation.
 */

import { useChatStore } from '../store/chatStore.ts';
import { useAuth } from '../../auth/authStore.ts';

const EMPTY: string[] = [];

export function useTypingIndicator(conversationId: string | null): string[] {
  const ids = useChatStore((s) => (conversationId ? s.typing[conversationId] ?? EMPTY : EMPTY));
  const users = useChatStore((s) => s.users);
  const meId = useAuth((s) => s.me?.id);
  return ids.filter((id) => id !== meId).map((id) => users[id]?.displayName ?? 'Someone');
}
