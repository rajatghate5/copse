/**
 * The roster. Reads conversations and the last message of each from the store
 * and renders a selectable list. Purely presentational beyond the click, so it
 * re-renders only when conversations or their latest message change.
 */

import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { conversationName, otherMemberIds, previewOf } from '@/features/chat/selectors.ts';
import { unreadCount } from '@/features/chat/unread.ts';
import { messageTime } from '@/lib/format.ts';
import { Avatar } from '@/features/chat/components/Avatar.tsx';
import { ListSkeleton } from '@/components/Skeleton.tsx';
import { Plus } from '@/assets/svgs/plus/index.tsx';

interface Props {
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({ onSelect, onNew }: Props) {
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const connection = useChatStore((s) => s.connection);
  const users = useChatStore((s) => s.users);
  const activeId = useChatStore((s) => s.activeId);
  const seen = useChatStore((s) => s.seen);
  const meId = useAuth((s) => s.me?.id ?? '');

  const list = Object.values(conversations).sort((a, b) => {
    const la = messages[a.id]?.[messages[a.id]!.length - 1]?.sentAt ?? a.createdAt;
    const lb = messages[b.id]?.[messages[b.id]!.length - 1]?.sentAt ?? b.createdAt;
    return lb - la;
  });

  return (
    <div className="roster">
      <div className="roster-top">
        <span className="r-title">Chats</span>
        <button className="newbtn" aria-label="New conversation" onClick={onNew}>
          <Plus />
        </button>
      </div>
      <div className="rlist">
        {/* Nothing loaded AND not connected yet is not the same claim as "none
            exist" - hold the shape until the ready frame has actually landed. */}
        {list.length === 0 && connection !== 'online' && <ListSkeleton rows={4} />}
        {list.length === 0 && connection === 'online' && (
          <div className="empty">No conversations yet. Start one with the + button.</div>
        )}
        {list.map((conv) => {
          const name = conversationName(conv, users, meId);
          const msgs = messages[conv.id];
          const last = msgs?.[msgs.length - 1];
          // The open thread is never unread: you are looking at it, and the
          // count would clear a beat later anyway once the read is reported.
          const unread = conv.id === activeId ? 0 : unreadCount(msgs, seen[conv.id]);
          return (
            <button
              key={conv.id}
              className={`ritem ${conv.id === activeId ? 'active' : ''}${unread > 0 ? ' unread' : ''}`}
              onClick={() => onSelect(conv.id)}
            >
              <Avatar name={name} userIds={otherMemberIds(conv, meId)} />
              <span className="ri-main">
                <span className="ri-name">{name}</span>
                <span className="ri-prev">{previewOf(msgs)}</span>
              </span>
              <span className="ri-end">
                {last && <span className="ri-time">{messageTime(last.sentAt)}</span>}
                {/* "+9" rather than "9+"; the label keeps the exact number for
                    anyone reading it aloud. */}
                {unread > 0 && (
                  <span className="ri-badge" aria-label={`${unread} unread`}>
                    {unread > 9 ? '+9' : unread}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
