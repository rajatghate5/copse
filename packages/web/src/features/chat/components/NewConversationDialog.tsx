/**
 * Start a conversation: pick one person for a direct chat, or several for a
 * group. The conversation key is generated and wrapped to each member on
 * confirm (in the engine), so this dialog only collects who.
 */

import { useState } from 'react';
import { useChatStore } from '../store/chatStore.ts';
import { useAuth } from '../../auth/authStore.ts';
import { createConversation } from '../engine.ts';
import { initials } from '../../../lib/format.ts';
import { Check } from '../../../lib/icons.tsx';

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

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <h2>New conversation</h2>
        <p>Pick one person for a direct chat, or several for a group.</p>
        <div className="member-pick">
          {others.length === 0 && <div className="empty">No one else has joined yet.</div>}
          {others.map((u) => (
            <button key={u.id} className={`member ${picked.has(u.id) ? 'on' : ''}`} onClick={() => toggle(u.id)}>
              <span className="av sm">{initials(u.displayName)}</span>
              <span className="mname">{u.displayName} <span style={{ color: 'var(--faint)', fontWeight: 400 }}>@{u.username}</span></span>
              {picked.has(u.id) && <Check className="mcheck" />}
            </button>
          ))}
        </div>
        <button className="btn" disabled={picked.size === 0} onClick={start}>
          {picked.size <= 1 ? 'Start chat' : `Start group (${picked.size})`}
        </button>
      </div>
    </div>
  );
}
