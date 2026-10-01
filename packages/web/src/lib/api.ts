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
  RegisterResponse,
  RoomResponse,
  RoomsResponse,
  RoomSummary,
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

export function register(req: RegisterRequest): Promise<RegisterResponse> {
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

// --- rooms ------------------------------------------------------------------

/** Every room the signed-in user belongs to (each carries its invite code). */
export async function listRooms(): Promise<RoomSummary[]> {
  const res = await fetch('/api/rooms', { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'could not list rooms');
  return ((await res.json()) as RoomsResponse).rooms;
}

/** Mint a new room (admins unlimited; members capped). Returns it with its code. */
export async function createRoom(name: string): Promise<RoomSummary> {
  return (await post<RoomResponse>('/api/rooms', { name })).room;
}

/** Join an existing room by its invite code. */
export async function joinRoom(joinCode: string): Promise<RoomSummary> {
  return (await post<RoomResponse>('/api/rooms/join', { joinCode })).room;
}

/** Rotate a room's invite code, invalidating the old link. */
export async function rotateRoomCode(roomId: string): Promise<RoomSummary> {
  return (await post<RoomResponse>(`/api/rooms/${encodeURIComponent(roomId)}/rotate`, {})).room;
}

export type { PublicKeys };
