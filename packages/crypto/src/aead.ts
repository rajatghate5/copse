/**
 * AES-256-GCM, the one symmetric primitive Copse uses.
 *
 * WebCrypto rather than a JS implementation: it is constant-time, hardware
 * accelerated, and present in both the browser and Bun. GCM authenticates as it
 * encrypts, so a tampered ciphertext fails to open rather than decrypting to
 * garbage - which is the property the tamper tests rely on.
 *
 * The IV is 96 bits, generated fresh per call. Reusing an IV under one key
 * breaks GCM catastrophically, so every seal makes a new random one and ships
 * it alongside the ciphertext; it is not secret.
 */

import { randomBytes } from './bytes.ts';

const IV_LENGTH = 12;

/**
 * WebCrypto's TypeScript types insist on ArrayBuffer-backed views, while the
 * noble helpers return the wider `Uint8Array<ArrayBufferLike>`. At runtime these
 * are the same object; this cast bridges the type gap in one place so the rest
 * of the file stays clean.
 */
const src = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

async function importKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  return crypto.subtle.importKey('raw', src(key), 'AES-GCM', false, [usage]);
}

/** A GCM ciphertext and the IV needed to open it. */
export interface Sealed {
  readonly iv: Uint8Array;
  /** Ciphertext with the GCM tag appended, as WebCrypto returns it. */
  readonly ciphertext: Uint8Array;
}

/**
 * Encrypt `plaintext` under `key`, binding `aad` into the authentication tag.
 *
 * `aad` is authenticated but not encrypted: the message's context (conversation,
 * sender, sequence) travels in clear but cannot be altered without the open
 * failing, so a ciphertext cannot be replayed into a different conversation.
 */
export async function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Sealed> {
  const iv = randomBytes(IV_LENGTH);
  const ck = await importKey(key, 'encrypt');
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: src(iv), additionalData: src(aad) },
    ck,
    src(plaintext),
  );
  return { iv, ciphertext: new Uint8Array(buf) };
}

/**
 * Decrypt and verify. Throws if the key, IV, AAD or ciphertext do not all agree
 * - the caller must treat a throw as "reject this message", never as empty text.
 */
export async function open(
  key: Uint8Array,
  sealed: Sealed,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const ck = await importKey(key, 'decrypt');
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: src(sealed.iv), additionalData: src(aad) },
    ck,
    src(sealed.ciphertext),
  );
  return new Uint8Array(buf);
}
