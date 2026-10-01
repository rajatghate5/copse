/**
 * Profile & settings, in one sheet: who you are, the rooms you're in, appearance,
 * your key fingerprint, and sign out. It reads identity from the auth store and
 * rooms from the room store; it owns no data of its own.
 */

import { MAX_ROOMS_PER_USER, ROOM_MAX_MEMBERS } from '@copse/protocol';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { ThemeToggle } from '@/components/common.tsx';
import { initials } from '@/lib/format.ts';
import { LogOut } from '@/assets/svgs/log-out/index.tsx';

/** A short, readable fingerprint of a public key, for an at-a-glance self-check. */
function fingerprint(sigPub: string): string {
  const compact = sigPub.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16);
  return (compact.match(/.{1,4}/g) ?? []).join(' ');
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const me = useAuth((s) => s.me!);
  const signOut = useAuth((s) => s.signOut);
  const rooms = useRoomStore((s) => s.rooms);

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet profile" onClick={(e) => e.stopPropagation()}>
        <div className="p-head">
          <span className="av lg">{initials(me.displayName)}</span>
          <div>
            <div className="p-name">
              {me.displayName}
              {me.isAdmin && <span className="abadge">admin</span>}
            </div>
            <div className="p-user">@{me.username}</div>
          </div>
        </div>

        <div className="p-sect">
          <span>Your rooms</span>
          <span className="p-cnt">{me.isAdmin ? 'admin · no limit' : `${rooms.length} / ${MAX_ROOMS_PER_USER}`}</span>
        </div>
        {rooms.map((r) => (
          <div className="p-room" key={r.id}>
            <span className="rdot" />
            <span className="p-rname">{r.name}</span>
            <span className="p-rmeta">{r.memberCount}/{ROOM_MAX_MEMBERS}</span>
          </div>
        ))}

        <div className="p-sect"><span>Appearance</span></div>
        <ThemeToggle />

        <div className="p-sect"><span>Security · your key</span></div>
        <div className="fingerprint">{fingerprint(me.keys.sigPub)}</div>

        <button className="btn danger-btn" onClick={() => void signOut()}><LogOut /> Sign out &amp; lock</button>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
