/**
 * Pick where to forward a message.
 *
 * Forwarding re-seals the text with the target conversation's key, on this
 * device - there is no other way, since the server holds neither key. So a
 * forward is an ordinary new message that happens to say where it came from,
 * which is also why it cannot carry the original's ticks or time.
 *
 * Only conversations in this room are offered: a conversation key never crosses
 * rooms, and neither should a message.
 */

import { useState } from 'react';
import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { conversationName, otherMemberIds } from '@/features/chat/selectors.ts';
import { forwardText } from '@/features/chat/engine.ts';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';
import { Avatar } from '@/features/chat/components/Avatar.tsx';
import { Check } from '@/assets/svgs/check/index.tsx';

export function ForwardDialog({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const users = useChatStore((s) => s.users);
  const meId = useAuth((s) => s.me?.id ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const targets = Object.values(conversations).filter((c) => c.id !== message.conversationId);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const go = () => {
    if (picked.size === 0) return;
    for (const id of picked) void forwardText(id, message);
    onClose();
  };

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Forward to">
        <h2>Forward</h2>
        <p>The message is sealed again for whoever you send it to, and says who wrote it.</p>
        <div className="act-preview">{message.text || '(no text)'}</div>
        <div className="member-pick">
          {targets.length === 0 && <div className="empty">No other conversation in this room yet.</div>}
          {targets.map((c) => {
            const name = conversationName(c, users, meId);
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={picked.has(c.id)}
                className={`member ${picked.has(c.id) ? 'on' : ''}`}
                onClick={() => toggle(c.id)}
              >
                <span className="mbox" aria-hidden="true">{picked.has(c.id) && <Check />}</span>
                <Avatar name={name} size="sm" userIds={otherMemberIds(c, meId)} />
                <span className="mname">{name}</span>
              </button>
            );
          })}
        </div>
        <button className="btn" disabled={picked.size === 0} onClick={go}>
          {picked.size <= 1 ? 'Forward' : `Forward to ${picked.size}`}
        </button>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
