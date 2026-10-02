/**
 * Staying unlocked across a reload, for a bounded time.
 *
 * The identity normally exists only in RAM, so a reload loses it and the
 * passphrase screen comes back. That is the right default and it stays the
 * default on a fresh tab — but within one tab, retyping a passphrase after
 * every refresh is friction without a matching gain, so this keeps the mnemonic
 * recoverable under three limits, any one of which ends it:
 *
 *   1. the tab closes      — the sealed blob lives in sessionStorage
 *   2. IDLE_LIMIT_MS passes without the user doing anything
 *   3. sign out            — both halves are destroyed
 *
 * Two halves, neither useful alone. The blob in sessionStorage is AES-GCM
 * ciphertext. The key is a non-extractable CryptoKey in IndexedDB: this code can
 * decrypt with it but cannot read its bytes, so the mnemonic is never readable
 * at rest and cannot be copied out of the browser.
 *
 * What this trades, stated plainly: for the length of that window, access to an
 * unlocked device is access to the messages. The passphrase-every-reload
 * behaviour was buying exactly that, and this spends it.
 */

import { base64ToBytes, bytesToBase64 } from '@copse/crypto';
import { clearResumeKey, loadResumeKey, saveResumeKey } from '@/lib/idb.ts';

/** Idle time before the blob stops being accepted. */
export const IDLE_LIMIT_MS = 20 * 60 * 1000;

const BLOB_KEY = 'copse.resume';
/** Binds the ciphertext to this use, so the blob cannot be fed anywhere else. */
const AAD = new TextEncoder().encode('copse-resume-v1');
/** Don't rewrite sessionStorage on every mousemove. */
const TOUCH_THROTTLE_MS = 30_000;

/** Same shim as `crypto/aead.ts`: the lib types want ArrayBuffer-backed views. */
const src = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

interface Blob {
  iv: string;
  ct: string;
  expiresAt: number;
}

function readBlob(): Blob | null {
  try {
    const raw = sessionStorage.getItem(BLOB_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Blob;
    const ok = typeof b?.iv === 'string' && typeof b?.ct === 'string' && typeof b?.expiresAt === 'number';
    return ok ? b : null;
  } catch { return null; }
}

function writeBlob(b: Blob): void {
  try { sessionStorage.setItem(BLOB_KEY, JSON.stringify(b)); } catch { /* no resume, then */ }
}

/** Forget the blob but keep the key: another tab may still be using it. */
export function clearBlob(): void {
  try { sessionStorage.removeItem(BLOB_KEY); } catch { /* ignore */ }
}

/** Forget both. For signing out, where nothing should survive. */
export async function clearAll(): Promise<void> {
  clearBlob();
  await clearResumeKey();
}

/** Seal the mnemonic for this tab. Called whenever an unlock succeeds. */
export async function arm(mnemonic: string): Promise<void> {
  try {
    let key = await loadResumeKey();
    if (!key) {
      // extractable: false — the whole point. Even this module cannot read it.
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await saveResumeKey(key);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: src(iv), additionalData: src(AAD) },
      key,
      src(new TextEncoder().encode(mnemonic)),
    );
    writeBlob({ iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)), expiresAt: Date.now() + IDLE_LIMIT_MS });
  } catch { /* resume is a convenience; the passphrase always works */ }
}

/** The mnemonic, if this tab may still have it. Null means ask for a passphrase. */
export async function resume(): Promise<string | null> {
  const b = readBlob();
  if (!b) return null;
  if (b.expiresAt < Date.now()) { clearBlob(); return null; }
  try {
    const key = await loadResumeKey();
    if (!key) { clearBlob(); return null; }
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: src(base64ToBytes(b.iv)), additionalData: src(AAD) },
      key,
      src(base64ToBytes(b.ct)),
    );
    // Coming back counts as activity.
    touch(true);
    return new TextDecoder().decode(pt);
  } catch {
    // Wrong key, tampered blob, or crypto unavailable: fall back to the passphrase.
    clearBlob();
    return null;
  }
}

let lastTouch = 0;

/** Push the deadline out. Throttled, since it fires on real user input. */
export function touch(force = false): void {
  const now = Date.now();
  if (!force && now - lastTouch < TOUCH_THROTTLE_MS) return;
  const b = readBlob();
  if (!b) return;
  lastTouch = now;
  writeBlob({ ...b, expiresAt: now + IDLE_LIMIT_MS });
}

/**
 * Watch for activity and for the deadline passing. Returns a disposer.
 *
 * The check also runs when the tab becomes visible again: a laptop asleep for an
 * hour should lock on waking, not sixty seconds later.
 */
export function watchIdle(onExpire: () => void): () => void {
  const check = (): void => {
    const b = readBlob();
    if (b && b.expiresAt < Date.now()) onExpire();
  };
  const bump = (): void => touch();
  const onVisible = (): void => { if (document.visibilityState === 'visible') check(); };

  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  for (const e of events) window.addEventListener(e, bump, { passive: true });
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, 60_000);

  return () => {
    for (const e of events) window.removeEventListener(e, bump);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  };
}
