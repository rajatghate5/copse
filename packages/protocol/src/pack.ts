/**
 * Packing a WrappedKey into a single base64 string and back.
 *
 * A wrapped key is three byte-strings (ephemeral public key, IV, ciphertext).
 * Rather than spread them across three JSON fields, we length-prefix and
 * concatenate them into one blob the server can store as a single column and
 * never has to understand. The client is the only side that packs or unpacks.
 */

import { base64ToBytes, bytesToBase64, concatBytes, type WrappedKey } from '@copse/crypto';

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

/** Pack a WrappedKey into one base64 string for the wire. */
export function packWrappedKey(w: WrappedKey): string {
  const blob = concatBytes(
    u16(w.ephPub.length), w.ephPub,
    u16(w.iv.length), w.iv,
    u16(w.ciphertext.length), w.ciphertext,
  );
  return bytesToBase64(blob);
}

/** Unpack a base64 blob back into a WrappedKey. Throws on a malformed blob. */
export function unpackWrappedKey(b64: string): WrappedKey {
  const blob = base64ToBytes(b64);
  let o = 0;
  const take = (): Uint8Array => {
    if (o + 2 > blob.length) throw new Error('truncated wrapped key');
    const len = (blob[o]! << 8) | blob[o + 1]!;
    o += 2;
    if (o + len > blob.length) throw new Error('truncated wrapped key');
    const out = blob.slice(o, o + len);
    o += len;
    return out;
  };
  const ephPub = take();
  const iv = take();
  const ciphertext = take();
  return { ephPub, iv, ciphertext };
}
