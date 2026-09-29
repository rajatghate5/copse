/**
 * Sealing and opening one chat message.
 *
 * A message is encrypted under the shared conversation key AND signed with the
 * sender's Ed25519 key. Both are necessary:
 *
 *   - Encryption keeps the server (and the network) from reading the message.
 *   - The signature answers a question encryption alone cannot: every member
 *     holds the same conversation key, so any member could otherwise forge a
 *     message as any other. The signature binds the ciphertext to one identity.
 *
 * The AAD ties each message to its place - conversation, sender, sequence
 * number. A ciphertext lifted from one slot cannot be replayed into another:
 * the AAD would differ and the open would fail.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { seal, open } from './aead.ts';
import { concatBytes, utf8ToBytes } from './bytes.ts';

/** Everything needed to place a message, other than its contents. */
export interface MessageContext {
  readonly conversationId: string;
  readonly senderId: string;
  /** Per-sender monotonic counter; part of the AAD, so gaps are detectable. */
  readonly seq: number;
}

/** A sealed message, ready for the wire and the database. */
export interface SealedMessage {
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  /** Ed25519 signature over context ‖ iv ‖ ciphertext. */
  readonly signature: Uint8Array;
}

/** Canonical byte encoding of the context, used as AAD and signed. */
function contextBytes(ctx: MessageContext): Uint8Array {
  return utf8ToBytes(`${ctx.conversationId}\u001f${ctx.senderId}\u001f${ctx.seq}`);
}

/** Encrypt and sign one message. */
export async function sealMessage(
  conversationKey: Uint8Array,
  senderSigPriv: Uint8Array,
  ctx: MessageContext,
  plaintext: Uint8Array,
): Promise<SealedMessage> {
  const aad = contextBytes(ctx);
  const sealed = await seal(conversationKey, plaintext, aad);
  const signature = ed25519.sign(concatBytes(aad, sealed.iv, sealed.ciphertext), senderSigPriv);
  return { iv: sealed.iv, ciphertext: sealed.ciphertext, signature };
}

/**
 * Verify the signature, then decrypt.
 *
 * Signature first: a message failing verification is never decrypted, so a
 * forged sender is rejected before its contents are ever produced. Throws on
 * either failure; the caller rejects the message.
 */
export async function openMessage(
  conversationKey: Uint8Array,
  senderSigPub: Uint8Array,
  ctx: MessageContext,
  sealed: SealedMessage,
): Promise<Uint8Array> {
  const aad = contextBytes(ctx);
  const signed = concatBytes(aad, sealed.iv, sealed.ciphertext);
  if (!ed25519.verify(sealed.signature, signed, senderSigPub)) {
    throw new Error('message signature does not verify');
  }
  return open(conversationKey, { iv: sealed.iv, ciphertext: sealed.ciphertext }, aad);
}
