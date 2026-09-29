/**
 * A conversation has one symmetric key that every member shares. Messages are
 * encrypted under it (see message.ts). The question this file answers is: how
 * does that key reach each member without the server ever learning it?
 *
 * Answer: it is wrapped separately for each member using ECIES. For a recipient
 * we generate a throwaway X25519 keypair, do ECDH against the recipient's public
 * encryption key, HKDF the shared secret into an AES key, and wrap the
 * conversation key with it. We publish the throwaway public key next to the
 * wrapped blob; the recipient repeats the ECDH with their private key to recover
 * the same AES key and unwrap. The server stores these blobs and can open none
 * of them - it holds no private key.
 *
 * Using an ephemeral keypair per wrap (rather than the creator's long-term key)
 * means a wrap reveals nothing about who created it and needs no sender-identity
 * lookup to open: the ephemeral public key in the blob is all that is required.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { seal, open, type Sealed } from './aead.ts';
import { randomBytes, utf8ToBytes } from './bytes.ts';

const WRAP_INFO = utf8ToBytes('copse-key-wrap-v1');

/** A random AES-256 key. The secret every member of one conversation shares. */
export function generateConversationKey(): Uint8Array {
  return randomBytes(32);
}

/** A conversation key wrapped for exactly one recipient. Safe for the server. */
export interface WrappedKey {
  /** Ephemeral X25519 public key for this wrap; the recipient ECDHs against it. */
  readonly ephPub: Uint8Array;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

function wrapSecret(ephPriv: Uint8Array, recipientEncPub: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(ephPriv, recipientEncPub);
  return hkdf(sha256, shared, undefined, WRAP_INFO, 32);
}

/** Wrap `conversationKey` so only the holder of `recipientEncPub`'s key can open it. */
export async function wrapKeyFor(
  conversationKey: Uint8Array,
  recipientEncPub: Uint8Array,
): Promise<WrappedKey> {
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const wrappingKey = wrapSecret(ephPriv, recipientEncPub);
  // No AAD: the ephemeral public key is the only context and it travels in the
  // blob already, bound to this ciphertext by the shared-secret derivation.
  const sealed = await seal(wrappingKey, conversationKey, new Uint8Array(0));
  return { ephPub, iv: sealed.iv, ciphertext: sealed.ciphertext };
}

/**
 * Recover a conversation key from a wrap addressed to us. Throws if the wrap was
 * not for this key or has been tampered with.
 */
export async function unwrapKey(
  wrapped: WrappedKey,
  recipientEncPriv: Uint8Array,
): Promise<Uint8Array> {
  const shared = x25519.getSharedSecret(recipientEncPriv, wrapped.ephPub);
  const wrappingKey = hkdf(sha256, shared, undefined, WRAP_INFO, 32);
  const sealed: Sealed = { iv: wrapped.iv, ciphertext: wrapped.ciphertext };
  return open(wrappingKey, sealed, new Uint8Array(0));
}
