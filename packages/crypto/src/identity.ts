/**
 * A Copse identity is two keypairs derived from one seed:
 *
 *   - an X25519 pair used for key agreement (wrapping conversation keys), and
 *   - an Ed25519 pair used for signing (messages, and the login challenge).
 *
 * The seed comes from a 24-word BIP39 mnemonic. That mnemonic is the whole of a
 * user's secret: written down once at signup, it can regenerate every private
 * key on any device. Nothing else recovers an account, by design - the server
 * holds only public keys.
 *
 * Derivation is deterministic: the same mnemonic always yields the same keys,
 * which is what makes the recovery phrase work. Two independent HKDF expansions
 * of the seed, with distinct info labels, keep the encryption and signing keys
 * cryptographically separated.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { utf8ToBytes } from './bytes.ts';

/** 256 bits of entropy => 24 words. */
const MNEMONIC_STRENGTH = 256;

/** Distinct HKDF info labels, so the two private keys can never collide. */
const ENC_INFO = utf8ToBytes('copse-x25519-identity-v1');
const SIG_INFO = utf8ToBytes('copse-ed25519-identity-v1');

/** The public half of an identity - the only part that ever leaves the device. */
export interface PublicIdentity {
  /** X25519 public key, for others to wrap conversation keys to. */
  readonly encPub: Uint8Array;
  /** Ed25519 public key, to verify this identity's signatures. */
  readonly sigPub: Uint8Array;
}

/** A full identity. The private halves never leave the browser that holds them. */
export interface Identity extends PublicIdentity {
  readonly encPriv: Uint8Array;
  readonly sigPriv: Uint8Array;
}

/** A fresh 24-word recovery phrase. Show it once; it is the account. */
export function generateMnemonicPhrase(): string {
  return generateMnemonic(wordlist, MNEMONIC_STRENGTH);
}

/** True if a phrase is a well-formed BIP39 mnemonic in our wordlist. */
export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(phrase.trim(), wordlist);
}

/**
 * Derive the full identity from a recovery phrase.
 *
 * Throws on an invalid phrase rather than silently deriving keys from garbage -
 * a typo in a recovery phrase must fail loudly, not log you into an empty
 * account.
 */
export function identityFromMnemonic(phrase: string): Identity {
  const normalized = phrase.trim();
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('invalid recovery phrase');
  }
  const seed = mnemonicToSeedSync(normalized);
  const encPriv = hkdf(sha256, seed, undefined, ENC_INFO, 32);
  const sigPriv = hkdf(sha256, seed, undefined, SIG_INFO, 32);
  return {
    encPriv,
    sigPriv,
    encPub: x25519.getPublicKey(encPriv),
    sigPub: ed25519.getPublicKey(sigPriv),
  };
}

/** Drop the private halves for anything that only needs to be shared. */
export function publicIdentity(id: Identity): PublicIdentity {
  return { encPub: id.encPub, sigPub: id.sigPub };
}
