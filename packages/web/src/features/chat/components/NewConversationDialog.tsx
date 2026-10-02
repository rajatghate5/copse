/**
 * Start a conversation: pick one person for a direct chat, or two or more for a
 * group. The conversation key is generated and wrapped to each member on
 * confirm (in the engine), so this dialog only collects who.
 *
 * The rows are checkboxes, deliberately. They used to be plain buttons that
 * happened to be multi-select, with the fact buried in one line of prose — so
 * people picked one person, got a direct chat, and concluded groups did not
 * exist. A box you can see two of ticked is the only thing that says "more than
 * one is allowed" before you try it.
 */

import { useState } from 'react';
import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { createConversation } from '@/features/chat/engine.ts';
import { Avatar } from '@/features/chat/components/Avatar.tsx';
import { Check } from '@/assets/svgs/check/index.tsx';

export function NewConversationDialog({ onClose }: { onClose: () => void }) {
  const users = useChatStore((s) => s.users);
  const meId = useAuth((s) => s.me?.id ?? '');
  const others = Object.values(users).filter((u) => u.id !== meId);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const start = () => {
    if (picked.size === 0) return;
    const kind = picked.size === 1 ? 'direct' : 'group';
    void createConversation(kind, [...picked]);
    onClose();
  };

  // Say what the button is about to make, in names, before it is pressed.
  const names = [...picked].map((id) => users[id]?.displayName).filter(Boolean) as string[];
  const summary = names.length === 0
    ? 'Pick one person, or two or more for a group.'
    : names.length === 1
      ? `Direct chat with ${names[0]}.`
      : `Group with ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <h2>New conversation</h2>
        <p>Tap one person for a direct chat, or two or more to make a group.</p>
        <div className="member-pick">
          {others.length === 0 && <div className="empty">No one else has joined yet.</div>}
          {others.map((u) => (
            <button
              key={u.id}
              type="button"
              role="checkbox"
              aria-checked={picked.has(u.id)}
              className={`member ${picked.has(u.id) ? 'on' : ''}`}
              onClick={() => toggle(u.id)}
            >
              <span className="mbox" aria-hidden="true">{picked.has(u.id) && <Check />}</span>
              <Avatar name={u.displayName} size="sm" userIds={[u.id]} />
              <span className="mname">{u.displayName} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>@{u.username}</span></span>
            </button>
          ))}
        </div>
        <p className="msum">{summary}</p>
        <button className="btn" disabled={picked.size === 0} onClick={start}>
          {picked.size <= 1 ? 'Start chat' : `Start group of ${picked.size + 1}`}
        </button>
      </div>
    </div>
  );
}
