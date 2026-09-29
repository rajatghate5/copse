/**
 * The REST client - account setup and login only. Everything real-time goes
 * over the socket (services/socket.ts). Same-origin in production and via the
 * Vite proxy in dev, so the session cookie rides along on its own; we only set
 * `credentials: 'include'` to be explicit.
 */

import type {
  ChallengeResponse,
  LoginRequest,
  PublicKeys,
  RegisterRequest,
  VaultBlob,
  VaultResponse,
} from '@copse/protocol';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (msg as { error?: string }).error ?? 'request failed');
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function register(req: RegisterRequest): Promise<{ userId: string }> {
  return post('/api/register', req);
}

export async function fetchVault(username: string): Promise<VaultBlob | null> {
  const res = await fetch(`/api/vault/${encodeURIComponent(username)}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, 'could not fetch vault');
  return ((await res.json()) as VaultResponse).vault;
}

export function challenge(username: string): Promise<ChallengeResponse> {
  return post('/api/challenge', { username });
}

export function login(req: LoginRequest): Promise<{ userId: string }> {
  return post('/api/login', req);
}

export function logout(): Promise<unknown> {
  return post('/api/logout', {});
}

/** The current invite code, for a logged-in member to build a share link. */
export async function getInvite(): Promise<string> {
  const res = await fetch('/api/invite', { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'could not get the invite');
  return ((await res.json()) as { invite: string }).invite;
}

export type { PublicKeys };
