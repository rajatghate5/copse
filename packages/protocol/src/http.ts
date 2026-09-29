/**
 * The REST surface, used only for account setup and login. Once a client has a
 * session cookie it upgrades to the WebSocket and everything else flows there.
 *
 * Auth is by keypair, not password (see @copse/crypto/challenge). A username is
 * the human handle used to find an account and log in; the private keys that
 * actually prove identity live inside the passphrase vault, which the server
 * stores as ciphertext so a second device can fetch and unlock it.
 */

import type { PublicKeys } from './index.ts';

/** A passphrase-sealed blob, all base64. The server stores it, never opens it. */
export interface VaultBlob {
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

/** POST /api/register - claim a username, publish public keys, deposit the vault. */
export interface RegisterRequest {
  readonly invite: string;
  readonly username: string;
  readonly displayName: string;
  readonly keys: PublicKeys;
  readonly vault: VaultBlob;
}

export interface RegisterResponse {
  readonly userId: string;
}

/** GET /api/vault/:username - fetch the sealed vault to unlock on a new device. */
export interface VaultResponse {
  readonly vault: VaultBlob;
}

/** POST /api/challenge - begin login for a username; returns a nonce to sign. */
export interface ChallengeRequest {
  readonly username: string;
}

export interface ChallengeResponse {
  /** base64 nonce, valid briefly and single-use. */
  readonly challenge: string;
}

/** POST /api/login - present a signed nonce; on success a session cookie is set. */
export interface LoginRequest {
  readonly username: string;
  readonly challenge: string;
  /** base64 Ed25519 signature over the challenge. */
  readonly signature: string;
}

export interface LoginResponse {
  readonly userId: string;
}

/** Shape of every error body the REST layer returns. */
export interface ApiError {
  readonly error: string;
}
