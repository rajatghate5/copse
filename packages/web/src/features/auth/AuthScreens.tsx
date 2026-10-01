/**
 * Everything before the chat: creating an account, unlocking one that's already
 * on this device, or signing in on a new device. Which screen shows is driven by
 * auth status (locked → unlock) and a local mode toggle (register ↔ sign in).
 */

import { useState } from 'react';
import { useAuth } from '@/features/auth/authStore.ts';
import { Brand, ThemeToggle } from '@/components/common.tsx';
import { Eye } from '@/assets/svgs/eye/index.tsx';
import { EyeOff } from '@/assets/svgs/eye-off/index.tsx';
import { Key } from '@/assets/svgs/key/index.tsx';
import { Lock } from '@/assets/svgs/lock/index.tsx';
import { Huddle } from '@/features/welcome/Huddle.tsx';

/** A passphrase field with a show/hide toggle. Local state only. */
function PassphraseField({ id, label, value, onChange, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          className="input"
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button className="pw-eye" type="button" aria-label={show ? 'Hide' : 'Show'} onClick={() => setShow((s) => !s)}>
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Huddle />
      <div className="frame">
        <div className="topbar">
          <Brand />
          <span className="spacer" />
          <ThemeToggle />
        </div>
        <div className="stage">
          <div className="center">{children}</div>
        </div>
      </div>
    </>
  );
}

function UnlockScreen() {
  const { account, unlock, signOut, busy, error, clearError } = useAuth();
  const [pass, setPass] = useState('');
  return (
    <Shell>
      <div className="card">
        <div className="hero-mark"><Lock /></div>
        <h1>Welcome back{account ? `, ${account.displayName}` : ''}</h1>
        <p className="sub">Enter your passphrase to unlock this device. Your keys are decrypted here and never leave.</p>
        <PassphraseField id="unlock-pass" label="Passphrase" value={pass} placeholder="Your passphrase" onChange={(v) => { setPass(v); clearError(); }} />
        {error && <div className="pperr">{error}</div>}
        <button className="btn" disabled={busy || !pass} onClick={() => void unlock(pass)}>
          {busy ? 'Unlocking…' : <><Key /> Unlock</>}
        </button>
        <div className="linkrow">
          Not you? <button onClick={() => void signOut()}>Use a different account</button>
        </div>
      </div>
    </Shell>
  );
}

function RegisterScreen({ toSignIn }: { toSignIn: () => void }) {
  const { register, busy, error, clearError } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  // Two ways in: an invite link (…/?join=CODE) into an existing room, or the
  // operator's link (…/?bootstrap=TOKEN) that mints the very first room as admin.
  const params = new URLSearchParams(location.search);
  const [joinCode, setJoinCode] = useState(() => params.get('join') ?? '');
  const bootstrapToken = params.get('bootstrap') ?? '';
  const isBootstrap = bootstrapToken.length > 0;
  const [roomName, setRoomName] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const next = () => {
    if (!isBootstrap && !joinCode.trim()) return setLocal('Enter your invite code.');
    if (username.trim().length < 3) return setLocal('Pick a username of at least 3 characters.');
    if (!displayName.trim()) return setLocal('Enter a display name.');
    setLocal(null);
    setStep(2);
  };

  const create = () => {
    if (pass.length < 8) return setLocal('Use a passphrase of at least 8 characters.');
    if (pass !== confirm) return setLocal("The passphrases don't match.");
    setLocal(null);
    void register({
      joinCode: isBootstrap ? undefined : joinCode.trim(),
      bootstrap: isBootstrap ? bootstrapToken : undefined,
      roomName: isBootstrap ? roomName.trim() || undefined : undefined,
      username: username.trim(),
      displayName: displayName.trim(),
      passphrase: pass,
    });
  };

  if (step === 1) {
    return (
      <Shell>
        <div className="card">
          <div className="hero-mark"><Lock /></div>
          {isBootstrap ? (
            <>
              <h1>Set up your Copse</h1>
              <p className="sub">You're creating the first room as its admin. Name it, pick who you are, and you're in. Share an invite afterwards to bring the others.</p>
              <label htmlFor="roomname">Room name</label>
              <input id="roomname" className="input" placeholder="e.g. the four" value={roomName} onChange={(e) => { setRoomName(e.target.value); setLocal(null); }} />
            </>
          ) : (
            <>
              <h1>Join the room</h1>
              <p className="sub">End-to-end encrypted. No phone number. Messages disappear after seven days. You'll need an invite to begin.</p>
              <label htmlFor="join">Invite code</label>
              <input id="join" className="input" placeholder="amber-pine-7f3a" value={joinCode} onChange={(e) => { setJoinCode(e.target.value); setLocal(null); }} />
            </>
          )}
          <label htmlFor="username">Username</label>
          <input id="username" className="input" placeholder="how friends find you" value={username} onChange={(e) => setUsername(e.target.value)} />
          <label htmlFor="display">Display name</label>
          <input id="display" className="input" placeholder="what friends see" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          {local && <div className="pperr">{local}</div>}
          <button className="btn" onClick={next}><Key /> Continue</button>
          <div className="linkrow">Already have an account? <button onClick={toSignIn}>Sign in on this device</button></div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="card">
        <h1>Set your passphrase</h1>
        <p className="sub">This unlocks Copse on this device and any other you sign in on. Your account is encrypted with it, and only the <b>locked</b> version is ever stored — so choose something only you know.</p>
        <PassphraseField id="p1" label="Passphrase" value={pass} placeholder="At least 8 characters" onChange={(v) => { setPass(v); clearError(); setLocal(null); }} />
        <PassphraseField id="p2" label="Confirm passphrase" value={confirm} placeholder="Type it again" onChange={(v) => { setConfirm(v); setLocal(null); }} />
        {(local || error) && <div className="pperr">{local ?? error}</div>}
        <button className="btn" disabled={busy} onClick={create}>{busy ? 'Creating…' : <><Lock /> {isBootstrap ? 'Create room & account' : 'Create account & join'}</>}</button>
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => setStep(1)}>Back</button>
        <p className="note"><Key /><span>No phrase to write down. Forget the passphrase and messages can't be recovered — that's the trade for a server that can never read them.</span></p>
      </div>
    </Shell>
  );
}

function SignInScreen({ toRegister }: { toRegister: () => void }) {
  const { signInOnNewDevice, busy, error, clearError } = useAuth();
  const [username, setUsername] = useState('');
  const [pass, setPass] = useState('');
  return (
    <Shell>
      <div className="card">
        <div className="hero-mark"><Key /></div>
        <h1>Sign in</h1>
        <p className="sub">On a new device? Enter your username and passphrase. Your sealed account is fetched and unlocked right here — the server never sees the passphrase.</p>
        <label htmlFor="si-user">Username</label>
        <input id="si-user" className="input" placeholder="your username" value={username} onChange={(e) => { setUsername(e.target.value); clearError(); }} />
        <PassphraseField id="si-pass" label="Passphrase" value={pass} placeholder="Your passphrase" onChange={(v) => { setPass(v); clearError(); }} />
        {error && <div className="pperr">{error}</div>}
        <button className="btn" disabled={busy || !username || !pass} onClick={() => void signInOnNewDevice({ username: username.trim(), passphrase: pass })}>
          {busy ? 'Unlocking…' : <><Key /> Sign in</>}
        </button>
        <div className="linkrow">Need an account? <button onClick={toRegister}>Create one</button></div>
      </div>
    </Shell>
  );
}

export function AuthScreens() {
  const status = useAuth((s) => s.status);
  const [mode, setMode] = useState<'register' | 'signin'>('register');

  if (status === 'locked') return <UnlockScreen />;
  return mode === 'register'
    ? <RegisterScreen toSignIn={() => setMode('signin')} />
    : <SignInScreen toRegister={() => setMode('register')} />;
}
