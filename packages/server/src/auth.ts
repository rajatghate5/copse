/**
 * Sessions and login challenges, held in memory.
 *
 * In memory on purpose: a session is just proof that someone recently signed a
 * nonce with their private key. If the server restarts, everyone signs a fresh
 * nonce and continues - no password to re-enter, because there is no password.
 * Nothing here is worth persisting, and keeping it out of the database keeps the
 * database to ciphertext and public keys only.
 *
 * Challenges expire quickly and are single-use, so a captured nonce is worthless
 * moments later and cannot be replayed.
 */

import { randomBytes, bytesToBase64 } from '@copse/crypto';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // a week
const CHALLENGE_TTL_MS = 1000 * 60; // one minute to sign

export const SESSION_COOKIE = 'copse_session';

interface Session {
  userId: string;
  expires: number;
}

interface PendingChallenge {
  challenge: string;
  expires: number;
}

export class Sessions {
  private byToken = new Map<string, Session>();
  private challenges = new Map<string, PendingChallenge>();

  /** Issue a login nonce for a user. Overwrites any previous pending one. */
  issueChallenge(userId: string): string {
    const challenge = bytesToBase64(randomBytes(32));
    this.challenges.set(userId, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
    return challenge;
  }

  /**
   * Take the pending challenge for a user, consuming it. Returns null if there
   * is none or it has expired - either way the login attempt fails.
   */
  takeChallenge(userId: string): string | null {
    const pending = this.challenges.get(userId);
    this.challenges.delete(userId);
    if (!pending || pending.expires < Date.now()) return null;
    return pending.challenge;
  }

  /** Start a session and return its opaque token, to be set as a cookie. */
  create(userId: string): string {
    const token = bytesToBase64(randomBytes(32));
    this.byToken.set(token, { userId, expires: Date.now() + SESSION_TTL_MS });
    return token;
  }

  /** The user behind a session token, or null if unknown or expired. */
  resolve(token: string | undefined): string | null {
    if (!token) return null;
    const session = this.byToken.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) {
      this.byToken.delete(token);
      return null;
    }
    return session.userId;
  }

  destroy(token: string | undefined): void {
    if (token) this.byToken.delete(token);
  }
}

/** Read one cookie value out of a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}
