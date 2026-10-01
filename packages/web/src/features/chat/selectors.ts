/**
 * Turning stored records into what the UI shows. A direct chat is named after
 * the other person; a group after its members (titles are left unencrypted-free
 * for v1, so we derive a name rather than storing one).
 */

import type { ConversationSummary, UserSummary } from '@copse/protocol';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';

type Users = Record<string, UserSummary>;

export function otherMemberIds(conv: ConversationSummary, meId: string): string[] {
  return conv.memberIds.filter((id) => id !== meId);
}

export function conversationName(conv: ConversationSummary, users: Users, meId: string): string {
  const others = otherMemberIds(conv, meId).map((id) => users[id]?.displayName).filter(Boolean) as string[];
  if (conv.kind === 'direct') return others[0] ?? 'Direct message';
  if (others.length === 0) return 'Group';
  if (others.length <= 3) return others.join(', ');
  return `${others.slice(0, 2).join(', ')} +${others.length - 2}`;
}

export function conversationSubtitle(conv: ConversationSummary, users: Users, meId: string): string {
  const others = otherMemberIds(conv, meId).map((id) => users[id]?.displayName).filter(Boolean) as string[];
  if (conv.kind === 'direct') return `@${users[otherMemberIds(conv, meId)[0] ?? '']?.username ?? '…'}`;
  return `${others.length + 1} members`;
}

export function previewOf(messages: ChatMessage[] | undefined): string {
  const last = messages?.[messages.length - 1];
  if (!last) return 'No messages yet';
  return `${last.mine ? 'You: ' : ''}${last.text}`;
}
