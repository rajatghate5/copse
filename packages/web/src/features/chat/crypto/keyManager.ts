/**
 * The client's key desk. Everything that turns plaintext into what the wire
 * carries, and back, lives here - so components and the store never touch raw
 * crypto, only `encrypt` / `decrypt`.
 *
 * It holds the unlocked identity (in memory only) and a cache of conversation
 * keys (also mirrored to IndexedDB, so history decrypts after a reload without
 * asking the server to re-send keys). Per-conversation send sequence numbers
 * live here too, because they are part of what gets signed.
 */

import {
  type Identity,
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  openMessage,
  sealMessage,
  unwrapKey,
  utf8ToBytes,
  wrapKeyFor,
  generateConversationKey,
  type PublicIdentity,
} from '@copse/crypto';
import { packWrappedKey, unpackWrappedKey, type MemberKey, type PublicKeys } from '@copse/protocol';
import { loadConvKeys, saveConvKey } from '@/lib/idb.ts';

export class KeyManager {
  private convKeys = new Map<string, Uint8Array>();
  private seq = new Map<string, number>();

  constructor(private identity: Identity) {}

  /** Restore cached conversation keys from a previous session. */
  async hydrate(): Promise<void> {
    const stored = await loadConvKeys();
    for (const [id, b64] of Object.entries(stored)) this.convKeys.set(id, base64ToBytes(b64));
  }

  hasKey(conversationId: string): boolean {
    return this.convKeys.has(conversationId);
  }

  /** Remember a conversation key (used after unwrapping or after creating one). */
  private async remember(conversationId: string, key: Uint8Array): Promise<void> {
    this.convKeys.set(conversationId, key);
    await saveConvKey(conversationId, bytesToBase64(key));
  }

  /** A brand-new conversation key, wrapped once per member for `createConversation`. */
  async newConversationKeys(
    members: { userId: string; encPub: string }[],
  ): Promise<{ key: Uint8Array; wrapped: MemberKey[] }> {
    const key = generateConversationKey();
    const wrapped: MemberKey[] = [];
    for (const m of members) {
      const w = await wrapKeyFor(key, base64ToBytes(m.encPub));
      wrapped.push({ userId: m.userId, wrappedKey: packWrappedKey(w) });
    }
    return { key, wrapped };
  }

  async storeNewKey(conversationId: string, key: Uint8Array): Promise<void> {
    await this.remember(conversationId, key);
  }

  /** Unwrap a conversation key the server delivered for us. */
  async acceptWrappedKey(conversationId: string, wrappedKeyB64: string): Promise<void> {
    if (this.convKeys.has(conversationId)) return;
    const key = await unwrapKey(unpackWrappedKey(wrappedKeyB64), this.identity.encPriv);
    await this.remember(conversationId, key);
  }

  private nextSeq(conversationId: string): number {
    const next = (this.seq.get(conversationId) ?? 0) + 1;
    this.seq.set(conversationId, next);
    return next;
  }

  /** Seal + sign an outgoing message. Returns the wire fields plus the seq used. */
  async encrypt(
    conversationId: string,
    senderId: string,
    text: string,
  ): Promise<{ seq: number; iv: string; ciphertext: string; signature: string } | null> {
    const key = this.convKeys.get(conversationId);
    if (!key) return null;
    const seq = this.nextSeq(conversationId);
    const sealed = await sealMessage(key, this.identity.sigPriv, { conversationId, senderId, seq }, utf8ToBytes(text));
    return {
      seq,
      iv: bytesToBase64(sealed.iv),
      ciphertext: bytesToBase64(sealed.ciphertext),
      signature: bytesToBase64(sealed.signature),
    };
  }

  /** Verify + decrypt an incoming message. Returns null if we can't (no key). */
  async decrypt(
    msg: { conversationId: string; senderId: string; seq: number; iv: string; ciphertext: string; signature: string },
    senderSigPub: string,
  ): Promise<string | null> {
    const key = this.convKeys.get(msg.conversationId);
    if (!key) return null;
    const plaintext = await openMessage(
      key,
      base64ToBytes(senderSigPub),
      { conversationId: msg.conversationId, senderId: msg.senderId, seq: msg.seq },
      {
        iv: base64ToBytes(msg.iv),
        ciphertext: base64ToBytes(msg.ciphertext),
        signature: base64ToBytes(msg.signature),
      },
    );
    return bytesToUtf8(plaintext);
  }

  get me(): PublicIdentity {
    return { encPub: this.identity.encPub, sigPub: this.identity.sigPub };
  }
}

export type { PublicKeys };
