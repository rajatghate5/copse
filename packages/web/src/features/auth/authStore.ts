/**
 * Authentication state, in Zustand (never React Context - auth changes rarely,
 * but the identity and key manager it produces are shared widely and must not
 * force re-renders of the message tree).
 *
 * Four states: loading (checking storage), signedOut (no account here), locked
 * (an account is on this device, waiting for the passphrase), ready (unlocked
 * and logged in). The private identity only exists in memory in the `ready`
 * state - reload, and you are locked again until the passphrase is re-entered.
 */

import { create } from 'zustand';
import {
  type Identity,
  base64ToBytes as base64,
  bytesToBase64,
  generateMnemonicPhrase,
  identityFromMnemonic,
  openMnemonic,
  publicIdentity,
  sealMnemonic,
  signChallenge,
  type Vault,
} from '@copse/crypto';
import type { UserSummary } from '@copse/protocol';
import * as api from '@/lib/api.ts';
import { KeyManager } from '@/features/chat/crypto/keyManager.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { clearAccount, loadAccount, saveAccount, wipe, type StoredAccount } from '@/lib/idb.ts';

export type AuthStatus = 'loading' | 'signedOut' | 'locked' | 'ready';

interface AuthState {
  status: AuthStatus;
  account: StoredAccount | null;
  me: UserSummary | null;
  identity: Identity | null;
  km: KeyManager | null;
  busy: boolean;
  error: string | null;

  boot: () => Promise<void>;
  register: (args: {
    joinCode?: string;
    bootstrap?: string;
    roomName?: string;
    username: string;
    displayName: string;
    passphrase: string;
  }) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  signInOnNewDevice: (args: { username: string; passphrase: string }) => Promise<void>;
  /** Replace the identity summary with the server's authoritative one (admin flag). */
  setMe: (me: UserSummary) => void;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const b64 = (v: Vault) => ({
  salt: bytesToBase64(v.salt),
  iv: bytesToBase64(v.iv),
  ciphertext: bytesToBase64(v.ciphertext),
});

/** Prove key possession to the server and get a session cookie. */
async function establishSession(username: string, identity: Identity): Promise<string> {
  const { challenge } = await api.challenge(username);
  const signature = signChallenge(challenge, identity.sigPriv);
  const { userId } = await api.login({ username, challenge, signature });
  return userId;
}

async function ready(
  set: (p: Partial<AuthState>) => void,
  account: StoredAccount,
  identity: Identity,
  isAdmin = false,
) {
  const km = new KeyManager(identity);
  await km.hydrate();
  const me: UserSummary = {
    id: account.userId,
    username: account.username,
    displayName: account.displayName,
    keys: {
      encPub: bytesToBase64(identity.encPub),
      sigPub: bytesToBase64(identity.sigPub),
    },
    // The server's `ready` frame confirms this authoritatively (see engine.setMe);
    // here it is known only when this very session bootstrapped the first room.
    isAdmin,
  };
  set({ status: 'ready', account, identity, km, me, busy: false, error: null });
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  account: null,
  me: null,
  identity: null,
  km: null,
  busy: false,
  error: null,

  async boot() {
    const account = await loadAccount();
    set({ account, status: account ? 'locked' : 'signedOut' });
  },

  async register({ joinCode, bootstrap, roomName, username, displayName, passphrase }) {
    set({ busy: true, error: null });
    try {
      const mnemonic = generateMnemonicPhrase();
      const identity = identityFromMnemonic(mnemonic);
      const vault = await sealMnemonic(passphrase, mnemonic);
      const pub = publicIdentity(identity);
      const { userId, roomId } = await api.register({
        joinCode,
        bootstrap,
        roomName,
        username,
        displayName,
        keys: { encPub: bytesToBase64(pub.encPub), sigPub: bytesToBase64(pub.sigPub) },
        vault: b64(vault),
      });
      const account: StoredAccount = { userId, username, displayName, vault: b64(vault) };
      await saveAccount(account);
      // Enter the room this account just joined or created (held in memory only).
      useRoomStore.getState().setCurrent(roomId);
      await establishSession(username, identity);
      await ready(set, account, identity, Boolean(bootstrap));
    } catch (e) {
      set({ busy: false, error: (e as Error).message || 'could not create the account' });
    }
  },

  async unlock(passphrase) {
    const account = get().account;
    if (!account) return;
    set({ busy: true, error: null });
    try {
      const mnemonic = await openMnemonic(passphrase, {
        salt: base64(account.vault.salt),
        iv: base64(account.vault.iv),
        ciphertext: base64(account.vault.ciphertext),
      });
      const identity = identityFromMnemonic(mnemonic);
      await establishSession(account.username, identity);
      await ready(set, account, identity);
    } catch {
      // A wrong passphrase makes the AES-GCM open throw - the one honest signal.
      set({ busy: false, error: 'That passphrase did not unlock your account.' });
    }
  },

  async signInOnNewDevice({ username, passphrase }) {
    set({ busy: true, error: null });
    try {
      const blob = await api.fetchVault(username);
      if (!blob) throw new Error('no account with that username');
      const mnemonic = await openMnemonic(passphrase, {
        salt: base64(blob.salt),
        iv: base64(blob.iv),
        ciphertext: base64(blob.ciphertext),
      });
      const identity = identityFromMnemonic(mnemonic);
      const userId = await establishSession(username, identity);
      const account: StoredAccount = { userId, username, displayName: username, vault: blob };
      await saveAccount(account);
      await ready(set, account, identity);
    } catch (e) {
      const msg = (e as Error).message?.includes('username')
        ? 'No account with that username.'
        : 'That passphrase did not unlock the account.';
      set({ busy: false, error: msg });
    }
  },

  setMe(me) {
    set({ me });
  },

  async signOut() {
    try { await api.logout(); } catch { /* best effort */ }
    await wipe();
    await clearAccount();
    set({ status: 'signedOut', account: null, identity: null, km: null, me: null, error: null });
  },

  clearError() {
    set({ error: null });
  },
}));
