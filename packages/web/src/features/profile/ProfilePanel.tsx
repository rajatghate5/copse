/**
 * Profile & settings, in one sheet: who you are, the rooms you're in,
 * appearance, notifications, and sign out. It reads identity from the auth store
 * and rooms from the room store; it owns no data of its own.
 *
 * Grouped rows rather than stacked sections, because this is the surface that
 * accumulates: a new setting is one more row in an existing group, not another
 * heading and another full-width button.
 *
 * The limits are stated, not implied. A count on its own ("2 / 3", "3/10") only
 * means something if you already know the caps, and the caps are not symmetric:
 * a room holds ROOM_MAX_MEMBERS for everyone, admin included, while only the
 * number of rooms per person is lifted for the admin. Both come from
 * @copse/protocol, so this text cannot drift from what the server enforces.
 *
 * No key fingerprint here on purpose. The one it used to show was the server's
 * copy of the signing key with nothing local to compare it against, so it could
 * not catch a substituted key. Verification lives where it works: the pairwise
 * safety number (`crypto/safety.ts`), from a thread's Verify button.
 */

import { useState } from 'react';
import { MAX_ROOMS_PER_USER, ROOM_MAX_MEMBERS } from '@copse/protocol';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { useTheme, type ThemeChoice } from '@/lib/theme.ts';
import { initials } from '@/lib/format.ts';
import { disable, enable, permission, wanted } from '@/features/chat/notify.ts';
import { Sun } from '@/assets/svgs/sun/index.tsx';
import { Moon } from '@/assets/svgs/moon/index.tsx';
import { Monitor } from '@/assets/svgs/monitor/index.tsx';

/**
 * Icons rather than words: three labels crowded the row, and sun / moon /
 * display are about as understood as interface glyphs get. The label stays as
 * the accessible name and the hover title, so nothing depends on reading the
 * picture.
 */
const THEMES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Follow the system', Icon: Monitor },
];

function ThemeSegment() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="pm-seg">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          // aria-pressed, not a label change: the current state has to be
          // readable without inferring it from what the button offers to do.
          aria-pressed={choice === t.value}
          aria-label={t.label}
          title={t.label}
          className={choice === t.value ? 'on' : ''}
          onClick={() => setChoice(t.value)}
        >
          <t.Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function Switch({ on, disabled, label, onChange }: {
  on: boolean; disabled?: boolean; label: string; onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`pm-switch${on ? ' on' : ''}`}
      onClick={onChange}
    >
      <span className="pm-knob" />
    </button>
  );
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const me = useAuth((s) => s.me!);
  const signOut = useAuth((s) => s.signOut);
  const rooms = useRoomStore((s) => s.rooms);
  const [notify, setNotify] = useState(() => wanted() && permission() === 'granted');
  const blocked = permission() === 'denied';

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet pm" role="dialog" aria-label="Profile and settings">
        <header className="pm-id">
          <span className="av lg">{initials(me.displayName)}</span>
          <div className="pm-who">
            <div className="pm-name">
              {me.displayName}
              {me.isAdmin && <span className="abadge">admin</span>}
            </div>
            <div className="pm-user">@{me.username}</div>
          </div>
          <button type="button" className="pm-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="pm-body">
          <div className="pm-label">
            <span>Rooms</span>
            {/* Admin still needs the count — "no limit" alone hid how many there
                were. Non-admins get the count against the cap they have. */}
            <span className="pm-count">
              {me.isAdmin
                ? `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · no limit`
                : `${rooms.length} of ${MAX_ROOMS_PER_USER}`}
            </span>
          </div>
          <div className="pm-group">
            {rooms.length === 0 && <div className="pm-row pm-empty">You're not in a room yet.</div>}
            {rooms.map((r) => (
              <div className="pm-row" key={r.id}>
                <span className="rdot" />
                <span className="pm-rname">{r.name}</span>
                <span className="pm-spacer" />
                <span className="pm-meta">{r.memberCount} of {ROOM_MAX_MEMBERS}</span>
              </div>
            ))}
          </div>
          <p className="pm-note">
            Up to {ROOM_MAX_MEMBERS} people in a room.{' '}
            {me.isAdmin
              ? `As admin you can make as many rooms as you like — the ${ROOM_MAX_MEMBERS}-person cap still applies to each one.`
              : `You can be in ${MAX_ROOMS_PER_USER} rooms at a time.`}
          </p>

          <div className="pm-label"><span>Settings</span></div>
          <div className="pm-group">
            <div className="pm-row">
              <span className="pm-rname">Appearance</span>
              <span className="pm-spacer" />
              <ThemeSegment />
            </div>
            <div className="pm-row">
              <span className="pm-rname">Message notifications</span>
              <span className="pm-spacer" />
              <Switch
                on={notify}
                disabled={blocked}
                label="Message notifications"
                onChange={async () => {
                  if (notify) { disable(); return setNotify(false); }
                  setNotify(await enable());
                }}
              />
            </div>
          </div>
          <p className="pm-note">
            {blocked
              ? 'This browser has blocked notifications for Copse. Allow them in its site settings first.'
              : 'Only who sent it, never what they said — a notification is drawn by the operating system, and lands on lock screens and in its logs.'}
          </p>

          <div className="pm-group pm-last">
            {/* Centred rather than list-aligned: it acts immediately, with no
                confirmation behind it, so it should read as a button being
                pressed and not as the next row in a list. */}
            <button type="button" className="pm-row pm-danger" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <p className="pm-note">
            Signing out removes this account from this device, so coming back needs your
            username as well as your passphrase.
          </p>
        </div>
      </div>
    </div>
  );
}
