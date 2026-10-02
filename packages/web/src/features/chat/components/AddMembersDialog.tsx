/**
 * Add people to a conversation that already exists.
 *
 * The warning is the point of this dialog, not decoration. There is one key per
 * conversation and no re-keying, so whoever is added can read the whole thread
 * as it already stands - everything still inside the 7-day window, said before
 * they were anywhere near it. That is a consequence of a shared conversation key
 * with no forward secrecy, which Copse has by design; the only honest thing to
 * do is say so before the key leaves this device, not after.
 *
 * Adding a third person to a direct chat makes it a group - the server promotes
 * it, because a conversation with three people in it is one - so the button says
 * that rather than letting it happen quietly.
 */

import { useState } from 'react';
import { RETENTION_DAYS, type ConversationSummary } from '@copse/protocol';
import { useChatStore } from '@/features/chat/store/chatStore.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import { addMembers } from '@/features/chat/engine.ts';
import { Avatar } from '@/features/chat/components/Avatar.tsx';
import { Check } from '@/assets/svgs/check/index.tsx';

export function AddMembersDialog({ conversation, onClose }: {
  conversation: ConversationSummary;
  onClose: () => void;
}) {
  const users = useChatStore((s) => s.users);
  const meId = useAuth((s) => s.me?.id ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Everyone in the room who is not already in this conversation. This is also
  // why there is no size check here: the candidates are the room's own members,
  // and a room is capped below the server's per-conversation limit, so the two
  // caps cannot both be reachable. The server still enforces its own.
  const candidates = Object.values(users).filter(
    (u) => u.id !== meId && !conversation.memberIds.includes(u.id),
  );

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const confirm = () => {
    if (picked.size === 0) return;
    void addMembers(conversation.id, [...picked]);
    onClose();
  };

  const names = [...picked].map((id) => users[id]?.displayName).filter(Boolean) as string[];
  const total = conversation.memberIds.length + picked.size;
  const becomesGroup = conversation.kind === 'direct' && picked.size > 0;

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Add people">
        <h2>Add people</h2>
        <p>
          {becomesGroup
            ? 'Anyone you add turns this direct chat into a group.'
            : 'Pick anyone from this room who is not in the conversation yet.'}
        </p>
        <div className="member-pick">
          {candidates.length === 0 && (
            <div className="empty">Everyone in this room is already in this conversation.</div>
          )}
          {candidates.map((u) => (
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
              <span className="mname">
                {u.displayName}{' '}
                <span style={{ color: 'var(--faint)', fontWeight: 400 }}>@{u.username}</span>
              </span>
            </button>
          ))}
        </div>

        {picked.size > 0 && (
          <p className="mwarn">
            {names.length === 1
              ? names[0]
              : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}{' '}
            will be able to read everything already in this conversation, not only what comes
            next — up to {RETENTION_DAYS} days of it, which is everything that has not
            expired.
          </p>
        )}
        <button className="btn" disabled={picked.size === 0} onClick={confirm}>
          {picked.size === 0
            ? 'Add to conversation'
            : becomesGroup
              ? `Make a group of ${total}`
              : `Add ${picked.size === 1 ? names[0] ?? 'them' : `${picked.size} people`}`}
        </button>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
