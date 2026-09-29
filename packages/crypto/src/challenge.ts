/**
 * Login is proving you hold a private key, not knowing a password.
 *
 * The server sends a random nonce; the client signs it; the server verifies
 * against the signing public key it already has on file for that user. A
 * stolen nonce is worthless without the private key, and the private key never
 * moves. This is the entire authentication mechanism.
 *
 * The nonce is prefixed with a fixed label before signing, so a signature
 * produced here can never be mistaken for a signature over a chat message or
 * any other Copse payload.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes, bytesToBase64, concatBytes, randomBytes, utf8ToBytes } from './bytes.ts';

const CHALLENGE_PREFIX = utf8ToBytes('copse-login-challenge-v1\u001f');

/** A fresh 32-byte login nonce, base64 for transport. Server-side. */
export function generateChallenge(): string {
  return bytesToBase64(randomBytes(32));
}

/** Sign a base64 challenge with the identity's signing key. Client-side. */
export function signChallenge(challenge: string, sigPriv: Uint8Array): string {
  const message = concatBytes(CHALLENGE_PREFIX, base64ToBytes(challenge));
  return bytesToBase64(ed25519.sign(message, sigPriv));
}

/** Verify a signed challenge against a known signing public key. Server-side. */
export function verifyChallenge(
  challenge: string,
  signatureB64: string,
  sigPub: Uint8Array,
): boolean {
  try {
    const message = concatBytes(CHALLENGE_PREFIX, base64ToBytes(challenge));
    return ed25519.verify(base64ToBytes(signatureB64), message, sigPub);
  } catch {
    // Malformed base64 or wrong-length signature is a failed login, not a crash.
    return false;
  }
}
