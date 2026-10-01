/**
 * The room switcher: the control that makes rooms real in the UI. It lists the
 * rooms you belong to, switches between them (which reconnects the socket), and
 * holds the per-room actions - copy the invite link, rotate the code, join another
 * room by code, and create a new one (unlimited for the admin, capped for members).
 */

import { useState } from 'react';
import { MAX_ROOMS_PER_USER, ROOM_MAX_MEMBERS } from '@copse/protocol';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { switchRoom } from '@/features/chat/engine.ts';
import { useAuth } from '@/features/auth/authStore.ts';
import * as api from '@/lib/api.ts';
import { ChevronDown } from '@/assets/svgs/chevron-down/index.tsx';
import { LinkIcon } from '@/assets/svgs/link/index.tsx';
import { Plus } from '@/assets/svgs/plus/index.tsx';
import { Refresh } from '@/assets/svgs/refresh/index.tsx';

export function RoomSwitcher() {
  const rooms = useRoomStore((s) => s.rooms);
  const currentId = useRoomStore((s) => s.currentRoomId);
  const upsertRoom = useRoomStore((s) => s.upsertRoom);
  const me = useAuth((s) => s.me);

  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const current = rooms.find((r) => r.id === currentId) ?? null;
  const atCap = !me?.isAdmin && rooms.length >= MAX_ROOMS_PER_USER;

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 3200);
  };

  const copyInvite = async () => {
    if (!current) return;
    const link = `${location.origin}/?join=${encodeURIComponent(current.inviteCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      flash('Invite link copied — share it to bring someone in.');
    } catch {
      flash(`Invite code: ${current.inviteCode}`);
    }
    setOpen(false);
  };

  const rotate = async () => {
    if (!current) return;
    try {
      upsertRoom(await api.rotateRoomCode(current.id));
      flash('New invite code generated — the old link no longer works.');
    } catch (e) {
      flash((e as Error).message || 'Could not rotate the code.');
    }
    setOpen(false);
  };

  return (
    <div className="roomswitch">
      <button className="roomswitch-btn" onClick={() => setOpen((o) => !o)}>
        <span className="rdot" />
        <span className="rs-name">{current?.name ?? 'No room'}</span>
        <ChevronDown />
      </button>

      {open && (
        <>
          <div className="rs-scrim" onClick={() => setOpen(false)} />
          <div className="roommenu" role="menu">
            <div className="rm-head">Switch room</div>
            {rooms.map((r) => (
              <button
                key={r.id}
                className={`rm-room ${r.id === currentId ? 'on' : ''}`}
                onClick={() => { switchRoom(r.id); setOpen(false); }}
              >
                <span className="rdot" />
                <span className="rm-name">{r.name}</span>
                <span className="rm-meta">{r.memberCount}/{ROOM_MAX_MEMBERS}</span>
              </button>
            ))}
            <div className="rm-div" />
            <button className="rm-act" onClick={() => void copyInvite()}><LinkIcon /> Copy invite link</button>
            <button className="rm-act" onClick={() => void rotate()}><Refresh /> New invite code</button>
            <button className="rm-act" onClick={() => { setDialog('join'); setOpen(false); }}>Join with a code</button>
            <button className="rm-act" disabled={atCap} onClick={() => { setDialog('create'); setOpen(false); }}>
              <Plus /> Create a room {atCap && <span className="rm-meta">limit reached</span>}
            </button>
          </div>
        </>
      )}

      {note && <div className="rs-note">{note}</div>}

      {dialog === 'create' && (
        <RoomDialog
          title="Create a room"
          hint={me?.isAdmin ? 'As the admin you can create as many rooms as you like.' : `You can be in up to ${MAX_ROOMS_PER_USER} rooms.`}
          label="Room name"
          placeholder="e.g. weekenders"
          action="Create room"
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            const room = await api.createRoom(value);
            upsertRoom(room);
            switchRoom(room.id);
          }}
        />
      )}
      {dialog === 'join' && (
        <RoomDialog
          title="Join a room"
          hint="Paste an invite code someone shared with you."
          label="Invite code"
          placeholder="amber-pine-7f3a"
          action="Join room"
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            const room = await api.joinRoom(value);
            upsertRoom(room);
            switchRoom(room.id);
          }}
        />
      )}
    </div>
  );
}

/** A tiny shared modal for the two text-in-one-field room actions. */
function RoomDialog({ title, hint, label, placeholder, action, onClose, onSubmit }: {
  title: string; hint: string; label: string; placeholder: string; action: string;
  onClose: () => void; onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message || 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{hint}</p>
        <label htmlFor="roomdialog">{label}</label>
        <input
          id="roomdialog"
          className="input"
          placeholder={placeholder}
          value={value}
          autoFocus
          onChange={(e) => { setValue(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        {err && <div className="pperr">{err}</div>}
        <button className="btn" disabled={busy || !value.trim()} onClick={() => void submit()}>
          {busy ? 'Working…' : action}
        </button>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
