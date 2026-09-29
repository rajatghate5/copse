/**
 * The roster. Reads conversations and the last message of each from the store
 * and renders a selectable list. Purely presentational beyond the click, so it
 * re-renders only when conversations or their latest message change.
 */

import { useChatStore } from '../store/chatStore.ts';
import { useAuth } from '../../auth/authStore.ts';
import { conversationName, previewOf } from '../selectors.ts';
import { initials, messageTime } from '../../../lib/format.ts';
import { Plus } from '../../../lib/icons.tsx';

interface Props {
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({ onSelect, onNew }: Props) {
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const users = useChatStore((s) => s.users);
  const activeId = useChatStore((s) => s.activeId);
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
        {list.length === 0 && <div className="empty">No conversations yet. Start one with the + button.</div>}
        {list.map((conv) => {
          const name = conversationName(conv, users, meId);
          const msgs = messages[conv.id];
          const last = msgs?.[msgs.length - 1];
          return (
            <button
              key={conv.id}
              className={`ritem ${conv.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(conv.id)}
            >
              <span className="av">{initials(name)}</span>
              <span className="ri-main">
                <span className="ri-name">{name}</span>
                <span className="ri-prev">{previewOf(msgs)}</span>
              </span>
              {last && <span className="ri-time">{messageTime(last.sentAt)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
