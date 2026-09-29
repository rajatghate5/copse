/**
 * Safety numbers - the human-checkable defence against a lying server.
 *
 * Copse's server distributes public keys. A dishonest one could hand you its own
 * key in place of your contact's and read everything. No amount of encryption
 * catches this on its own, because from the client's side a substituted key is
 * just a key. The fix is out of band: both people read the same short number and
 * confirm it matches. If the server swapped a key, the numbers differ and the
 * lie is visible.
 *
 * The construction follows Signal's: hash each identity many times into a
 * fingerprint, render it as decimal digits, and sort the two fingerprints so
 * both ends compute the same string regardless of who looks first.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from './bytes.ts';
import type { PublicIdentity } from './identity.ts';

/** Iterated hashing slows brute-force search for a colliding key. */
const ITERATIONS = 5200;
const VERSION = utf8ToBytes('copse-safety-v1');

/** One party's fingerprint: 30 bytes, from many rounds of hashing its keys. */
function fingerprint(id: PublicIdentity): Uint8Array {
  let h = concatBytes(VERSION, id.encPub, id.sigPub);
  for (let i = 0; i < ITERATIONS; i++) {
    h = sha256(concatBytes(h, VERSION));
  }
  return h.slice(0, 30);
}

/** 30 bytes -> 30 decimal digits, six groups of five (each 5 bytes -> 5 digits). */
function toDigits(fp: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 30; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + fp[i + j]!;
    out += (n % 100000).toString().padStart(5, '0');
  }
  return out;
}

/** Lexicographic byte comparison, to order the two fingerprints deterministically. */
function lessOrEqual(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return true;
}

/**
 * The 60-digit safety number for a pair of identities, grouped into blocks of
 * five for reading aloud. Order-independent: both people see the same string.
 */
export function safetyNumber(a: PublicIdentity, b: PublicIdentity): string {
  const fa = fingerprint(a);
  const fb = fingerprint(b);
  const [first, second] = lessOrEqual(fa, fb) ? [fa, fb] : [fb, fa];
  const digits = toDigits(first) + toDigits(second);
  return digits.match(/.{1,5}/g)!.join(' ');
}
