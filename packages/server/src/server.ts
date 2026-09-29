/**
 * The server: REST for account setup and login, a WebSocket for everything else.
 *
 * Two rules run through all of it, inherited from No Mercy and extended:
 *   1. The client sends intent; the server owns state. Every inbound field is
 *      validated against the socket's authenticated identity before it acts.
 *   2. The server never sees plaintext. Message bodies, titles and wrapped keys
 *      are opaque strings it routes and stores but cannot read.
 *
 * `createServer` returns a plain Bun.serve options object so it can be started
 * for real (main.ts) or against an in-memory store (tests) with no difference.
 */

import { Hono } from 'hono';
import type { ServerWebSocket } from 'bun';
import {
  cleanB64,
  cleanName,
  cleanUsername,
  parseClientMessage,
  KEY_B64_MAX,
  MAX_CIPHERTEXT_LENGTH,
  MAX_MEMBERS,
  MAX_WRAPPED_KEY_LENGTH,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type RegisterRequest,
  type ChallengeRequest,
  type LoginRequest,
  type VaultBlob,
} from '@copse/protocol';
import { verifyChallenge, base64ToBytes } from '@copse/crypto';
import { Sessions, SESSION_COOKIE, readCookie } from './auth.ts';
import { Hub, type SocketData } from './hub.ts';
import type { Store } from './store.ts';

/** Ported from No Mercy: a coarse per-socket flood guard. */
const RATE_LIMIT_MSGS = 60;
const RATE_LIMIT_WINDOW_MS = 5000;

export interface ServerOptions {
  store: Store;
  /** The one invite code that authorises registration. Empty closes signup. */
  invite: string;
  /** Directory of the built web client, served for all non-API routes. */
  staticDir?: string;
  /** Set Secure on the session cookie. True in production behind HTTPS. */
  secureCookie?: boolean;
}

export interface CopseServer {
  fetch: (req: Request, server: import('bun').Server<SocketData>) => Response | Promise<Response> | undefined;
  websocket: import('bun').WebSocketHandler<SocketData>;
  /** Exposed for tests. */
  sessions: Sessions;
}

export function createServer(opts: ServerOptions): CopseServer {
  const { store, invite } = opts;
  const sessions = new Sessions();
  const hub = new Hub();

  const app = new Hono();

  app.get('/health', (c) => c.text('ok'));

  // --- registration: claim a username, publish keys, deposit the vault -------
  app.post('/api/register', async (c) => {
    const body = (await c.req.json().catch(() => null)) as RegisterRequest | null;
    if (!body) return c.json({ error: 'bad request' }, 400);
    if (!invite || body.invite !== invite) return c.json({ error: 'invalid invite' }, 403);

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

    if (await store.getUserByUsername(username)) {
      return c.json({ error: 'username taken' }, 409);
    }

    const vault: VaultBlob = { salt, iv, ciphertext };
    const user = await store.createUser({ username, displayName, encPub, sigPub, vault });
    // Tell everyone already online, so they can address conversations to the new
    // member without reconnecting.
    hub.sendMany(
      (await store.listUsers()).map((u) => u.id),
      { t: 'user', user },
    );
    return c.json({ userId: user.id });
  });

  // --- fetch a sealed vault, to unlock on a new device ----------------------
  // The blob is ciphertext, useless without the passphrase, so this is public
  // by username - the same way any login form reveals whether an account exists.
  app.get('/api/vault/:username', async (c) => {
    const username = cleanUsername(c.req.param('username'));
    if (!username) return c.json({ error: 'bad username' }, 400);
    const vault = await store.getVault(username);
    if (!vault) return c.json({ error: 'no such user' }, 404);
    return c.json({ vault });
  });

  // --- invite link: a logged-in member reveals the code to share ------------
  // In this small-group model, members invite members, so an authenticated
  // session may read the invite code to build a share link. It stays behind the
  // session, never public.
  app.get('/api/invite', (c) => {
    const userId = sessions.resolve(readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE));
    if (!userId) return c.json({ error: 'unauthenticated' }, 401);
    if (!invite) return c.json({ error: 'invites are closed' }, 404);
    return c.json({ invite });
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
    // The nonce must be the exact one we issued (not expired, not reused) AND the
    // signature must verify against this user's registered signing key.
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
    switch (msg.t) {
      case 'createConversation': {
        if (!Array.isArray(msg.members) || msg.members.length === 0 || msg.members.length > MAX_MEMBERS) {
          return send(ws, { t: 'error', code: 'bad_message', message: 'bad member list' });
        }
        // The creator must be in their own conversation, and every member must be
        // a real, distinct user with a validly-sized wrapped key.
        const seen = new Set<string>();
        for (const m of msg.members) {
          if (typeof m.userId !== 'string' || seen.has(m.userId)) {
            return send(ws, { t: 'error', code: 'bad_message', message: 'bad member' });
          }
          seen.add(m.userId);
          if (!cleanB64(m.wrappedKey, MAX_WRAPPED_KEY_LENGTH)) {
            return send(ws, { t: 'error', code: 'bad_message', message: 'bad wrapped key' });
          }
          if (!(await store.getUser(m.userId))) {
            return send(ws, { t: 'error', code: 'bad_message', message: 'unknown member' });
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
          kind: msg.kind === 'group' ? 'group' : 'direct',
          titleCiphertext: title,
          createdBy: me,
          members: msg.members,
        });
        // Each member learns of the conversation and receives their own wrapped
        // key - and only their own.
        for (const m of msg.members) {
          hub.send(m.userId, { t: 'conversation', conversation: conv });
          hub.send(m.userId, { t: 'key', conversationId: conv.id, wrappedKey: m.wrappedKey });
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
        // Fan out to every member, including the sender (so their other tabs and
        // their own view converge on the server's id and timestamp).
        hub.sendMany(await store.memberIds(msg.conversationId), { t: 'message', message: stored });
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

      case 'typing': {
        if (!(await store.isMember(msg.conversationId, me))) return;
        const others = (await store.memberIds(msg.conversationId)).filter((id) => id !== me);
        hub.sendMany(others, {
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
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        const userId = sessions.resolve(readCookie(req.headers.get('cookie'), SESSION_COOKIE));
        if (!userId) return new Response('unauthorized', { status: 401 });
        const ok = server.upgrade(req, {
          data: { userId, rate: { count: 0, until: 0 } } satisfies SocketData,
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
        const [you, users, conversations] = await Promise.all([
          store.getUser(me),
          store.listUsers(),
          store.listConversationsForUser(me),
        ]);
        if (you) send(ws, { t: 'ready', you, users, conversations });
        // Deliver this user's wrapped conversation keys, so a fresh session or a
        // new device can decrypt history. Each blob is sealed to them alone.
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
      },
    },
  };
}
