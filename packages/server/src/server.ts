/**
 * The server: REST for account setup, login and rooms; a WebSocket for the chat
 * itself. Three rules run through all of it:
 *   1. The client sends intent; the server owns state. Every inbound field is
 *      validated against the socket's authenticated identity before it acts.
 *   2. The server never sees plaintext. Message bodies, titles and wrapped keys
 *      are opaque strings it routes and stores but cannot read.
 *   3. Rooms are sealed worlds. A socket is scoped to one room, and the directory,
 *      conversations and fan-out it sees are that room's alone.
 *
 * `createServer` returns a plain Bun.serve options object so it can be started
 * for real (main.ts) or against an in-memory store (tests) with no difference.
 */

import { Hono } from 'hono';
import type { ServerWebSocket } from 'bun';
import {
  cleanB64,
  cleanInviteCode,
  cleanName,
  cleanRoomName,
  cleanUsername,
  parseClientMessage,
  KEY_B64_MAX,
  MAX_CIPHERTEXT_LENGTH,
  MAX_MEMBERS,
  MAX_ROOMS_PER_USER,
  MAX_WRAPPED_KEY_LENGTH,
  PROTOCOL_VERSION,
  ROOM_MAX_MEMBERS,
  type ClientMessage,
  type ServerMessage,
  type RegisterRequest,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type ChallengeRequest,
  type LoginRequest,
  type RoomSummary,
  type VaultBlob,
} from '@copse/protocol';
import { verifyChallenge, base64ToBytes } from '@copse/crypto';
import { Sessions, SESSION_COOKIE, readCookie } from './auth.ts';
import { Hub, type SocketData } from './hub.ts';
import { uniqueInviteCode } from './rooms.ts';
import { HISTORY_PAGE, type Store } from './store.ts';

/** Ported from No Mercy: a coarse per-socket flood guard. */
const RATE_LIMIT_MSGS = 60;
const RATE_LIMIT_WINDOW_MS = 5000;

export interface ServerOptions {
  store: Store;
  /**
   * The operator's secret. Presented once via the signup flow it mints the first
   * room and makes that account the admin. Empty means no first room can be made,
   * so the server stays closed until it is set.
   */
  bootstrap: string;
  /** Directory of the built web client, served for all non-API routes. */
  staticDir?: string;
  /** Set Secure on the session cookie. True in production behind HTTPS. */
  secureCookie?: boolean;
}

export interface CopseServer {
  fetch: (
    req: Request,
    server: import('bun').Server<SocketData>,
  ) => Response | Promise<Response | undefined> | undefined;
  websocket: import('bun').WebSocketHandler<SocketData>;
  /** Exposed for tests. */
  sessions: Sessions;
}

export function createServer(opts: ServerOptions): CopseServer {
  const { store, bootstrap } = opts;
  const sessions = new Sessions();
  const hub = new Hub();

  const app = new Hono();

  /** The signed-in user id behind a request's cookie, or null. */
  const whoami = (c: { req: { header(name: string): string | undefined } }): string | null =>
    sessions.resolve(readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE));

  /** Mint an invite code the store confirms is free. */
  const freshCode = () => uniqueInviteCode((code) => store.getRoomByCode(code).then(Boolean));

  app.get('/health', (c) => c.text('ok'));

  // --- registration: create an account and land it in a room -----------------
  // A new account arrives one of two ways: by following an invite into an
  // existing room (joinCode), or by presenting the operator's secret to mint the
  // first room as admin (bootstrap). The landing room is resolved before the user
  // is created, so a bad code never leaves an orphaned account.
  app.post('/api/register', async (c) => {
    const body = (await c.req.json().catch(() => null)) as RegisterRequest | null;
    if (!body) return c.json({ error: 'bad request' }, 400);

    const username = cleanUsername(body.username);
    if (!username) return c.json({ error: 'bad username' }, 400);
    const displayName = cleanName(body.displayName);
    const encPub = cleanB64(body.keys?.encPub, KEY_B64_MAX);
    const sigPub = cleanB64(body.keys?.sigPub, KEY_B64_MAX);
    if (!encPub || !sigPub) return c.json({ error: 'bad keys' }, 400);

    // The vault is opaque, but its parts must be plausible base64 so we do not
    // store junk that can never be unlocked.
    const salt = cleanB64(body.vault?.salt, KEY_B64_MAX);
    const iv = cleanB64(body.vault?.iv, KEY_B64_MAX);
    const ciphertext = cleanB64(body.vault?.ciphertext, MAX_CIPHERTEXT_LENGTH);
    if (!salt || !iv || !ciphertext) return c.json({ error: 'bad vault' }, 400);

    let isAdmin = false;
    let bootstrapRoomName: string | null = null;
    let joinRoom: RoomSummary | null = null;
    if (body.bootstrap) {
      if (!bootstrap || body.bootstrap !== bootstrap) return c.json({ error: 'invalid bootstrap' }, 403);
      isAdmin = true;
      bootstrapRoomName = cleanRoomName(body.roomName);
    } else {
      const code = cleanInviteCode(body.joinCode);
      if (!code) return c.json({ error: 'an invite is required' }, 403);
      joinRoom = await store.getRoomByCode(code);
      if (!joinRoom) return c.json({ error: 'invalid invite' }, 403);
      if (joinRoom.memberCount >= ROOM_MAX_MEMBERS) return c.json({ error: 'room is full' }, 403);
    }

    if (await store.getUserByUsername(username)) return c.json({ error: 'username taken' }, 409);

    const vault: VaultBlob = { salt, iv, ciphertext };
    const user = await store.createUser({ username, displayName, encPub, sigPub, vault, isAdmin });

    let roomId: string;
    if (bootstrapRoomName !== null) {
      const room = await store.createRoom({ name: bootstrapRoomName, inviteCode: await freshCode(), createdBy: user.id });
      roomId = room.id;
    } else {
      roomId = joinRoom!.id;
      await store.addRoomMember(roomId, user.id);
    }

    // Tell the room's online members a new person arrived, so they can wrap
    // conversation keys to them without reconnecting.
    hub.sendMany((await store.listUsersInRoom(roomId)).map((u) => u.id), roomId, { t: 'user', user });
    return c.json({ userId: user.id, roomId });
  });

  // --- fetch a sealed vault, to unlock on a new device ----------------------
  // The blob is ciphertext, useless without the passphrase, so this is public by
  // username - the same way any login form reveals whether an account exists.
  app.get('/api/vault/:username', async (c) => {
    const username = cleanUsername(c.req.param('username'));
    if (!username) return c.json({ error: 'bad username' }, 400);
    const vault = await store.getVault(username);
    if (!vault) return c.json({ error: 'no such user' }, 404);
    return c.json({ vault });
  });

  // --- rooms: create, join, list, rotate (all authenticated) ----------------

  app.post('/api/rooms', async (c) => {
    const me = whoami(c);
    const meUser = me ? await store.getUser(me) : null;
    if (!me || !meUser) return c.json({ error: 'unauthenticated' }, 401);
    const body = (await c.req.json().catch(() => null)) as CreateRoomRequest | null;
    const name = cleanRoomName(body?.name);
    // Members may hold only a few rooms; the admin is uncapped.
    if (!meUser.isAdmin && (await store.userRoomCount(me)) >= MAX_ROOMS_PER_USER) {
      return c.json({ error: 'room limit reached' }, 403);
    }
    const room = await store.createRoom({ name, inviteCode: await freshCode(), createdBy: me });
    return c.json({ room });
  });

  app.post('/api/rooms/join', async (c) => {
    const me = whoami(c);
    const meUser = me ? await store.getUser(me) : null;
    if (!me || !meUser) return c.json({ error: 'unauthenticated' }, 401);
    const body = (await c.req.json().catch(() => null)) as JoinRoomRequest | null;
    const code = cleanInviteCode(body?.joinCode);
    if (!code) return c.json({ error: 'bad code' }, 400);
    const room = await store.getRoomByCode(code);
    if (!room) return c.json({ error: 'invalid invite' }, 404);
    if (await store.isRoomMember(room.id, me)) return c.json({ room });
    if (room.memberCount >= ROOM_MAX_MEMBERS) return c.json({ error: 'room is full' }, 403);
    if (!meUser.isAdmin && (await store.userRoomCount(me)) >= MAX_ROOMS_PER_USER) {
      return c.json({ error: 'room limit reached' }, 403);
    }
    await store.addRoomMember(room.id, me);
    hub.sendMany((await store.listUsersInRoom(room.id)).map((u) => u.id), room.id, { t: 'user', user: meUser });
    return c.json({ room: (await store.getRoom(room.id)) ?? room });
  });

  app.get('/api/rooms', async (c) => {
    const me = whoami(c);
    if (!me) return c.json({ error: 'unauthenticated' }, 401);
    return c.json({ rooms: await store.listRoomsForUser(me) });
  });

  app.post('/api/rooms/:id/rotate', async (c) => {
    const me = whoami(c);
    if (!me) return c.json({ error: 'unauthenticated' }, 401);
    const roomId = c.req.param('id');
    if (!(await store.isRoomMember(roomId, me))) return c.json({ error: 'not a member' }, 403);
    await store.setRoomInviteCode(roomId, await freshCode());
    return c.json({ room: await store.getRoom(roomId) });
  });

  // --- login step 1: get a nonce to sign ------------------------------------
  app.post('/api/challenge', async (c) => {
    const body = (await c.req.json().catch(() => null)) as ChallengeRequest | null;
    const username = cleanUsername(body?.username);
    if (!username) return c.json({ error: 'bad request' }, 400);
    const user = await store.getUserByUsername(username);
    if (!user) return c.json({ error: 'no such user' }, 404);
    return c.json({ challenge: sessions.issueChallenge(user.id) });
  });

  // --- login step 2: present the signed nonce -------------------------------
  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginRequest | null;
    const username = cleanUsername(body?.username);
    if (!username || !body?.challenge || !body.signature) {
      return c.json({ error: 'bad request' }, 400);
    }
    const user = await store.getUserByUsername(username);
    if (!user) return c.json({ error: 'no such user' }, 404);

    const pending = sessions.takeChallenge(user.id);
    if (
      !pending ||
      pending !== body.challenge ||
      !verifyChallenge(body.challenge, body.signature, base64ToBytes(user.keys.sigPub))
    ) {
      return c.json({ error: 'login failed' }, 401);
    }

    const token = sessions.create(user.id);
    const secure = opts.secureCookie ? '; Secure' : '';
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`,
    );
    return c.json({ userId: user.id });
  });

  app.post('/api/logout', (c) => {
    sessions.destroy(readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE));
    c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
    return c.json({ ok: true });
  });

  // --- static client (SPA) --------------------------------------------------
  if (opts.staticDir) {
    const dir = opts.staticDir;
    app.get('*', async (c) => {
      const path = new URL(c.req.url).pathname;
      const file = Bun.file(`${dir}${path === '/' ? '/index.html' : path}`);
      if (await file.exists()) return new Response(file);
      // Unknown path with no dot => an SPA route; hand back index.html.
      if (!path.includes('.')) return new Response(Bun.file(`${dir}/index.html`));
      return c.notFound();
    });
  }

  // --- websocket dispatch ---------------------------------------------------

  const send = (ws: ServerWebSocket<SocketData>, msg: ServerMessage): void => {
    ws.send(JSON.stringify(msg));
  };

  /**
   * Tell a room who is on it. Derived from the socket registry, never from a
   * client: the server owns this state, as it does every other.
   */
  async function broadcastPresence(roomId: string): Promise<void> {
    try {
      const members = await store.listUsersInRoom(roomId);
      hub.sendMany(members.map((m) => m.id), roomId, { t: 'presence', userIds: hub.onlineIn(roomId) });
    } catch { /* a presence frame is never worth failing a socket over */ }
  }

  const rateLimited = (ws: ServerWebSocket<SocketData>): boolean => {
    const now = Date.now();
    const r = ws.data.rate;
    if (now > r.until) {
      r.count = 1;
      r.until = now + RATE_LIMIT_WINDOW_MS;
      return false;
    }
    r.count += 1;
    return r.count > RATE_LIMIT_MSGS;
  };

  async function handle(ws: ServerWebSocket<SocketData>, msg: ClientMessage): Promise<void> {
    const me = ws.data.userId;
    const room = ws.data.roomId;
    switch (msg.t) {
      case 'createConversation': {
        if (!Array.isArray(msg.members) || msg.members.length === 0 || msg.members.length > MAX_MEMBERS) {
          return send(ws, { t: 'error', code: 'bad_message', message: 'bad member list' });
        }
        // Every member must be a distinct member OF THIS ROOM with a validly-sized
        // wrapped key - you cannot pull someone from another room into a chat.
        const seen = new Set<string>();
        for (const m of msg.members) {
          if (typeof m.userId !== 'string' || seen.has(m.userId)) {
            return send(ws, { t: 'error', code: 'bad_message', message: 'bad member' });
          }
          seen.add(m.userId);
          if (!cleanB64(m.wrappedKey, MAX_WRAPPED_KEY_LENGTH)) {
            return send(ws, { t: 'error', code: 'bad_message', message: 'bad wrapped key' });
          }
          if (!(await store.isRoomMember(room, m.userId))) {
            return send(ws, { t: 'error', code: 'not_a_room_member', message: 'member not in room' });
          }
        }
        if (!seen.has(me)) {
          return send(ws, { t: 'error', code: 'bad_message', message: 'creator not a member' });
        }
        const title = msg.titleCiphertext == null ? null : cleanB64(msg.titleCiphertext, MAX_CIPHERTEXT_LENGTH);
        if (msg.titleCiphertext != null && !title) {
          return send(ws, { t: 'error', code: 'bad_message', message: 'bad title' });
        }
        const conv = await store.createConversation({
          roomId: room,
          kind: msg.kind === 'group' ? 'group' : 'direct',
          titleCiphertext: title,
          createdBy: me,
          members: msg.members,
        });
        // Each member learns of the conversation and receives their own wrapped
        // key - and only their own - on their socket for this room.
        for (const m of msg.members) {
          hub.send(m.userId, room, { t: 'conversation', conversation: conv });
          hub.send(m.userId, room, { t: 'key', conversationId: conv.id, wrappedKey: m.wrappedKey });
        }
        return;
      }

      case 'send': {
        if (!(await store.isMember(msg.conversationId, me))) {
          return send(ws, { t: 'error', code: 'not_a_member', message: 'not a member' });
        }
        const iv = cleanB64(msg.iv, KEY_B64_MAX);
        const ciphertext = cleanB64(msg.ciphertext, MAX_CIPHERTEXT_LENGTH);
        const signature = cleanB64(msg.signature, KEY_B64_MAX);
        if (!iv || !ciphertext || !signature || typeof msg.seq !== 'number') {
          return send(ws, { t: 'error', code: 'bad_message', message: 'bad message body' });
        }
        const stored = await store.appendMessage({
          conversationId: msg.conversationId,
          senderId: me,
          seq: msg.seq,
          iv,
          ciphertext,
          signature,
        });
        const memberIds = await store.memberIds(msg.conversationId);
        hub.sendMany(memberIds, room, { t: 'message', message: stored });

        // Delivered means another member's socket was there to take it. Derived
        // from the registry at fan-out, so it is a fact about this send and not
        // something a client can claim.
        const live = new Set(hub.onlineIn(room));
        if (memberIds.some((id) => id !== me && live.has(id))) {
          const at = Date.now();
          await store.markDelivered([stored.id], at);
          hub.send(me, room, { t: 'receipt', messageIds: [stored.id], kind: 'delivered', at });
        }
        return;
      }

      case 'history': {
        if (!(await store.isMember(msg.conversationId, me))) {
          return send(ws, { t: 'error', code: 'not_a_member', message: 'not a member' });
        }
        const messages = await store.history(msg.conversationId, msg.before);
        return send(ws, {
          t: 'history',
          conversationId: msg.conversationId,
          messages,
          done: messages.length === 0,
        });
      }

      case 'read': {
        if (!Array.isArray(msg.messageIds) || msg.messageIds.length === 0) return;
        if (msg.messageIds.length > HISTORY_PAGE) return;
        if (!(await store.isMember(msg.conversationId, me))) return;
        // Only this conversation's messages, and never the reader's own: you do
        // not get to mark your own message read.
        const page = await store.messagesByIds(msg.messageIds);
        const theirs = page.filter((m) => m.conversationId === msg.conversationId && m.senderId !== me);
        if (theirs.length === 0) return;
        const at = Date.now();
        await store.markRead(theirs.map((m) => m.id), at);
        // One frame per sender, carrying only that sender's own messages.
        const bySender = new Map<string, string[]>();
        for (const m of theirs) bySender.set(m.senderId, [...(bySender.get(m.senderId) ?? []), m.id]);
        for (const [senderId, ids] of bySender) {
          hub.send(senderId, room, { t: 'receipt', messageIds: ids, kind: 'read', at });
        }
        return;
      }

      case 'typing': {
        if (!(await store.isMember(msg.conversationId, me))) return;
        const others = (await store.memberIds(msg.conversationId)).filter((id) => id !== me);
        hub.sendMany(others, room, {
          t: 'typing',
          state: { userId: me, conversationId: msg.conversationId, typing: msg.typing === true },
        });
        return;
      }

      default:
        return send(ws, { t: 'error', code: 'bad_message', message: 'unknown message' });
    }
  }

  return {
    sessions,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        const userId = sessions.resolve(readCookie(req.headers.get('cookie'), SESSION_COOKIE));
        if (!userId) return new Response('unauthorized', { status: 401 });
        // The socket is scoped to one room, named on the upgrade URL. You must be
        // a member of it, or there is nothing to view.
        const roomId = url.searchParams.get('room') ?? '';
        if (!roomId || !(await store.isRoomMember(roomId, userId))) {
          return new Response('forbidden', { status: 403 });
        }
        const ok = server.upgrade(req, {
          data: { userId, roomId, rate: { count: 0, until: 0 } } satisfies SocketData,
        });
        return ok ? undefined : new Response('upgrade failed', { status: 400 });
      }
      return app.fetch(req, { server });
    },
    websocket: {
      async open(ws) {
        hub.add(ws);
        send(ws, { t: 'hello', version: PROTOCOL_VERSION });
        const me = ws.data.userId;
        const roomId = ws.data.roomId;
        const [you, room, rooms, users, conversations] = await Promise.all([
          store.getUser(me),
          store.getRoom(roomId),
          store.listRoomsForUser(me),
          store.listUsersInRoom(roomId),
          store.listConversationsForUser(me, roomId),
        ]);
        if (you && room) send(ws, { t: 'ready', you, room, rooms, users, conversations });
        // After `ready`, so this socket already knows the room's directory and
        // can map the ids it is about to receive.
        void broadcastPresence(roomId);
        // Deliver this user's wrapped conversation keys for this room, so a fresh
        // session or a new device can decrypt history. Each blob is sealed to them.
        for (const conv of conversations) {
          const wrappedKey = await store.wrappedKeyFor(conv.id, me);
          if (wrappedKey) send(ws, { t: 'key', conversationId: conv.id, wrappedKey });
        }
      },
      async message(ws, raw) {
        if (rateLimited(ws)) {
          return send(ws, { t: 'error', code: 'rate_limited', message: 'slow down' });
        }
        const text = typeof raw === 'string' ? raw : raw.toString();
        const msg = parseClientMessage(text);
        if (!msg) return send(ws, { t: 'error', code: 'bad_message', message: 'unparseable' });
        try {
          await handle(ws, msg);
        } catch {
          send(ws, { t: 'error', code: 'bad_message', message: 'failed to handle' });
        }
      },
      close(ws) {
        hub.remove(ws);
        // Remove first, so the list we send no longer counts this socket.
        void broadcastPresence(ws.data.roomId);
      },
    },
  };
}
