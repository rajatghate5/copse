/**
 * End-to-end server tests, run against BOTH storage backends so the two never
 * drift. Each spins up a real Bun.serve on an ephemeral port.
 *
 * The flow mirrors the real app: an admin bootstraps the first room, others join
 * it with its invite code, and a socket is scoped to one room. The decisive
 * assertion is still that what the server stores and forwards is ciphertext.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
type AnyServer = Server<any>;
import {
  generateMnemonicPhrase,
  identityFromMnemonic,
  publicIdentity,
  bytesToBase64,
  base64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
  signChallenge,
  generateConversationKey,
  wrapKeyFor,
  unwrapKey,
  sealMessage,
  openMessage,
  type Identity,
} from '@copse/crypto';
import {
  packWrappedKey,
  unpackWrappedKey,
  MAX_ROOMS_PER_USER,
  type ServerMessage,
  type UserSummary,
} from '@copse/protocol';
import { createServer } from '../src/server.ts';
import { SqliteStore } from '../src/store-sqlite.ts';
import { TursoStore } from '../src/store-turso.ts';
import type { Store } from '../src/store.ts';

const BOOTSTRAP = 'test-bootstrap';

interface Harness {
  base: string;
  server: AnyServer;
  /** Exposed so a test can assert what was actually persisted, not just the wire. */
  store: Store;
}

async function startServer(store: Store): Promise<Harness> {
  await store.init();
  const app = createServer({ store, bootstrap: BOOTSTRAP });
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  return { base: `http://localhost:${server.port}`, server, store };
}

// A throwaway vault blob. Its parts only need to look like base64; these tests
// never unlock it (that is covered in the crypto suite).
const FAKE_VAULT = { salt: 'QUJD', iv: 'QUJD', ciphertext: 'QUJDRA==' };

function keysOf(id: Identity) {
  const pub = publicIdentity(id);
  return { encPub: bytesToBase64(pub.encPub), sigPub: bytesToBase64(pub.sigPub) };
}

/** Bootstrap the first room as admin. Returns the new user id and room id. */
async function bootstrapRoom(
  base: string,
  username: string,
  id: Identity,
  roomName = 'the room',
): Promise<{ userId: string; roomId: string }> {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bootstrap: BOOTSTRAP, roomName, username, displayName: username, keys: keysOf(id), vault: FAKE_VAULT }),
  });
  expect(res.status).toBe(200);
  const j = await res.json();
  return { userId: j.userId as string, roomId: j.roomId as string };
}

/** Register a new account by following an invite code into an existing room. */
async function joinRoom(base: string, username: string, id: Identity, joinCode: string): Promise<{ userId: string; roomId: string }> {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ joinCode, username, displayName: username, keys: keysOf(id), vault: FAKE_VAULT }),
  });
  expect(res.status).toBe(200);
  const j = await res.json();
  return { userId: j.userId as string, roomId: j.roomId as string };
}

/** Full challenge-response login by username; returns the Set-Cookie to reuse. */
async function login(base: string, username: string, id: Identity): Promise<string> {
  const ch = await fetch(`${base}/api/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  expect(ch.status).toBe(200);
  const { challenge } = await ch.json();
  const signature = signChallenge(challenge, id.sigPriv);
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, challenge, signature }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie!.split(';')[0]!; // copse_session=...
}

/** The invite code for the first room the cookie's user belongs to. */
async function firstRoomCode(base: string, cookie: string): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const { rooms } = await res.json();
  return rooms[0].inviteCode as string;
}

/** Open an authenticated socket scoped to a room and collect frames. */
function openSocket(base: string, cookie: string, roomId: string): { ws: WebSocket; frames: ServerMessage[] } {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${roomId}`, { headers: { cookie } } as any);
  const frames: ServerMessage[] = [];
  ws.addEventListener('message', (ev) => frames.push(JSON.parse(ev.data as string)));
  return { ws, frames };
}

const waitFor = async <T>(get: () => T | undefined, ms = 2000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function runSuite(name: string, makeStore: () => Store) {
  describe(name, () => {
    const servers: AnyServer[] = [];
    afterAll(() => servers.forEach((s) => s.stop(true)));

    test('reports presence from live sockets, and withdraws it on disconnect', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const bob = identityFromMnemonic(generateMnemonicPhrase());
      const { userId: aliceId, roomId } = await bootstrapRoom(h.base, 'alice', alice);
      const aliceCookie = await login(h.base, 'alice', alice);
      const code = await firstRoomCode(h.base, aliceCookie);
      const { userId: bobId } = await joinRoom(h.base, 'bob', bob, code);
      const bobCookie = await login(h.base, 'bob', bob);

      const a = openSocket(h.base, aliceCookie, roomId);
      await waitFor(() => a.frames.find((f) => f.t === 'ready'));
      // Alice alone: she is the only one present.
      const alone = (await waitFor(() =>
        a.frames.find((f): f is Extract<ServerMessage, { t: 'presence' }> => f.t === 'presence'),
      ));
      expect(alone.userIds).toEqual([aliceId]);

      const b = openSocket(h.base, bobCookie, roomId);
      await waitFor(() => b.frames.find((f) => f.t === 'ready'));
      // Bob's arrival is announced to Alice, not just to Bob.
      const both = await waitFor(() => {
        const f = a.frames.filter((x): x is Extract<ServerMessage, { t: 'presence' }> => x.t === 'presence').at(-1);
        return f && f.userIds.length === 2 ? f : undefined;
      });
      expect([...both.userIds].sort()).toEqual([aliceId, bobId].sort());

      b.ws.close();
      // And withdrawn when he goes: presence is the socket registry, not a flag.
      const after = await waitFor(() => {
        const f = a.frames.filter((x): x is Extract<ServerMessage, { t: 'presence' }> => x.t === 'presence').at(-1);
        return f && f.userIds.length === 1 ? f : undefined;
      });
      expect(after.userIds).toEqual([aliceId]);
      a.ws.close();
    });

    test('rejects a socket with no session', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const res = await fetch(`${h.base}/ws`, { headers: { upgrade: 'websocket' } });
      expect(res.status).toBe(401);
    });

    test('rejects registration with an invalid invite code', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const res = await fetch(`${h.base}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: 'no-such-code', username: 'alice', displayName: 'alice', keys: keysOf(alice), vault: FAKE_VAULT }),
      });
      expect(res.status).toBe(403);
    });

    test('rejects a bootstrap with the wrong secret', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const res = await fetch(`${h.base}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrap: 'wrong', username: 'alice', displayName: 'alice', keys: keysOf(alice), vault: FAKE_VAULT }),
      });
      expect(res.status).toBe(403);
    });

    test('rejects login with a signature from the wrong key', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const imposter = identityFromMnemonic(generateMnemonicPhrase());
      await bootstrapRoom(h.base, 'alice', alice);
      const ch = await fetch(`${h.base}/api/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice' }),
      });
      const { challenge } = await ch.json();
      const signature = signChallenge(challenge, imposter.sigPriv);
      const res = await fetch(`${h.base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', challenge, signature }),
      });
      expect(res.status).toBe(401);
    });

    test('two users in a room exchange an end-to-end encrypted message', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);

      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const bob = identityFromMnemonic(generateMnemonicPhrase());
      const { userId: aliceId, roomId } = await bootstrapRoom(h.base, 'alice', alice);
      const aliceCookie = await login(h.base, 'alice', alice);
      const code = await firstRoomCode(h.base, aliceCookie);
      const { userId: bobId } = await joinRoom(h.base, 'bob', bob, code);
      const bobCookie = await login(h.base, 'bob', bob);

      const a = openSocket(h.base, aliceCookie, roomId);
      const b = openSocket(h.base, bobCookie, roomId);

      const aReady = (await waitFor(() => a.frames.find((f) => f.t === 'ready'))) as Extract<ServerMessage, { t: 'ready' }>;
      await waitFor(() => b.frames.find((f) => f.t === 'ready'));
      const bobSummary = aReady.users.find((u: UserSummary) => u.id === bobId)!;
      expect(bobSummary).toBeTruthy();
      expect(aReady.room.id).toBe(roomId);

      const convKey = generateConversationKey();
      const wrapForAlice = packWrappedKey(await wrapKeyFor(convKey, alice.encPub));
      const wrapForBob = packWrappedKey(await wrapKeyFor(convKey, base64ToBytes(bobSummary.keys.encPub)));

      a.ws.send(JSON.stringify({
        t: 'createConversation', kind: 'direct', titleCiphertext: null,
        members: [
          { userId: aliceId, wrappedKey: wrapForAlice },
          { userId: bobId, wrappedKey: wrapForBob },
        ],
      }));

      const bConv = (await waitFor(() => b.frames.find((f) => f.t === 'conversation'))) as Extract<ServerMessage, { t: 'conversation' }>;
      const bKey = (await waitFor(() => b.frames.find((f) => f.t === 'key'))) as Extract<ServerMessage, { t: 'key' }>;
      const bobConvKey = await unwrapKey(unpackWrappedKey(bKey.wrappedKey), bob.encPriv);
      expect(bytesToBase64(bobConvKey)).toBe(bytesToBase64(convKey));
      expect(bConv.conversation.roomId).toBe(roomId);

      const ctx = { conversationId: bConv.conversation.id, senderId: aliceId, seq: 1 };
      const sealed = await sealMessage(convKey, alice.sigPriv, ctx, utf8ToBytes('hello bob'));
      const cleanFrames = b.frames.length;
      a.ws.send(JSON.stringify({
        t: 'send', conversationId: ctx.conversationId, seq: 1,
        iv: bytesToBase64(sealed.iv), ciphertext: bytesToBase64(sealed.ciphertext), signature: bytesToBase64(sealed.signature),
      }));

      const bMsg = (await waitFor(() => b.frames.slice(cleanFrames).find((f) => f.t === 'message'))) as Extract<ServerMessage, { t: 'message' }>;
      expect(bMsg.message.ciphertext).not.toContain('hello');
      expect(JSON.stringify(bMsg.message)).not.toContain('hello bob');

      const opened = await openMessage(
        bobConvKey,
        base64ToBytes(aReady.you.keys.sigPub),
        { conversationId: ctx.conversationId, senderId: aliceId, seq: 1 },
        { iv: sealed.iv, ciphertext: sealed.ciphertext, signature: sealed.signature },
      );
      expect(bytesToUtf8(opened)).toBe('hello bob');

      a.ws.close();
      b.ws.close();
    });

    test('stamps delivered at fan-out and read when the recipient reports it', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);

      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const bob = identityFromMnemonic(generateMnemonicPhrase());
      const { userId: aliceId, roomId } = await bootstrapRoom(h.base, 'alice', alice);
      const aliceCookie = await login(h.base, 'alice', alice);
      const code = await firstRoomCode(h.base, aliceCookie);
      const { userId: bobId } = await joinRoom(h.base, 'bob', bob, code);
      const bobCookie = await login(h.base, 'bob', bob);

      const a = openSocket(h.base, aliceCookie, roomId);
      const b = openSocket(h.base, bobCookie, roomId);
      const aReady = (await waitFor(() => a.frames.find((f) => f.t === 'ready'))) as Extract<ServerMessage, { t: 'ready' }>;
      await waitFor(() => b.frames.find((f) => f.t === 'ready'));
      const bobSummary = aReady.users.find((u: UserSummary) => u.id === bobId)!;

      const convKey = generateConversationKey();
      a.ws.send(JSON.stringify({
        t: 'createConversation', kind: 'direct', titleCiphertext: null,
        members: [
          { userId: aliceId, wrappedKey: packWrappedKey(await wrapKeyFor(convKey, alice.encPub)) },
          { userId: bobId, wrappedKey: packWrappedKey(await wrapKeyFor(convKey, base64ToBytes(bobSummary.keys.encPub))) },
        ],
      }));
      const bConv = (await waitFor(() => b.frames.find((f) => f.t === 'conversation'))) as Extract<ServerMessage, { t: 'conversation' }>;
      const conversationId = bConv.conversation.id;

      const ctx = { conversationId, senderId: aliceId, seq: 1 };
      const sealed = await sealMessage(convKey, alice.sigPriv, ctx, utf8ToBytes('hello bob'));
      a.ws.send(JSON.stringify({
        t: 'send', conversationId, seq: 1,
        iv: bytesToBase64(sealed.iv), ciphertext: bytesToBase64(sealed.ciphertext), signature: bytesToBase64(sealed.signature),
      }));

      // Bob's socket was live at fan-out, so Alice is told it was delivered.
      const delivered = (await waitFor(() =>
        a.frames.find((f): f is Extract<ServerMessage, { t: 'receipt' }> => f.t === 'receipt' && f.kind === 'delivered'),
      ));
      const bMsg = (await waitFor(() => b.frames.find((f) => f.t === 'message'))) as Extract<ServerMessage, { t: 'message' }>;
      expect(delivered.messageIds).toEqual([bMsg.message.id]);

      // Reporting it read reaches the sender, and only the sender.
      b.ws.send(JSON.stringify({ t: 'read', conversationId, messageIds: [bMsg.message.id] }));
      const read = (await waitFor(() =>
        a.frames.find((f): f is Extract<ServerMessage, { t: 'receipt' }> => f.t === 'receipt' && f.kind === 'read'),
      ));
      expect(read.messageIds).toEqual([bMsg.message.id]);
      expect(b.frames.some((f) => f.t === 'receipt' && f.kind === 'read')).toBe(false);

      // Both stamps are durable, so a reload does not lose the ticks.
      const page = await h.store.history(conversationId, undefined);
      expect(page[0]!.deliveredAt).toBeGreaterThan(0);
      expect(page[0]!.readAt).toBeGreaterThan(0);

      // And a sender cannot mark their own message read.
      const before = page[0]!.readAt;
      a.ws.send(JSON.stringify({ t: 'read', conversationId, messageIds: [bMsg.message.id] }));
      await new Promise((r) => setTimeout(r, 60));
      const again = await h.store.history(conversationId, undefined);
      expect(again[0]!.readAt).toBe(before);

      a.ws.close();
      b.ws.close();
    });

    test('stamps delivered when a recipient who was offline fetches history', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);

      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const bob = identityFromMnemonic(generateMnemonicPhrase());
      const { userId: aliceId, roomId } = await bootstrapRoom(h.base, 'alice', alice);
      const aliceCookie = await login(h.base, 'alice', alice);
      const code = await firstRoomCode(h.base, aliceCookie);
      const { userId: bobId } = await joinRoom(h.base, 'bob', bob, code);
      const bobCookie = await login(h.base, 'bob', bob);

      // Both on, only long enough to create the conversation.
      const a = openSocket(h.base, aliceCookie, roomId);
      const b1 = openSocket(h.base, bobCookie, roomId);
      const aReady = (await waitFor(() => a.frames.find((f) => f.t === 'ready'))) as Extract<ServerMessage, { t: 'ready' }>;
      await waitFor(() => b1.frames.find((f) => f.t === 'ready'));
      const bobSummary = aReady.users.find((u: UserSummary) => u.id === bobId)!;

      const convKey = generateConversationKey();
      a.ws.send(JSON.stringify({
        t: 'createConversation', kind: 'direct', titleCiphertext: null,
        members: [
          { userId: aliceId, wrappedKey: packWrappedKey(await wrapKeyFor(convKey, alice.encPub)) },
          { userId: bobId, wrappedKey: packWrappedKey(await wrapKeyFor(convKey, base64ToBytes(bobSummary.keys.encPub))) },
        ],
      }));
      const bConv = (await waitFor(() => b1.frames.find((f) => f.t === 'conversation'))) as Extract<ServerMessage, { t: 'conversation' }>;
      const conversationId = bConv.conversation.id;

      // Bob leaves. Presence dropping to Alice alone is the signal his socket
      // is really gone, so the send below has nobody to deliver to.
      b1.ws.close();
      await waitFor(() => {
        const f = a.frames.filter((x): x is Extract<ServerMessage, { t: 'presence' }> => x.t === 'presence').at(-1);
        return f && f.userIds.length === 1 ? f : undefined;
      });

      const sealed = await sealMessage(convKey, alice.sigPriv, { conversationId, senderId: aliceId, seq: 1 }, utf8ToBytes('hello bob'));
      a.ws.send(JSON.stringify({
        t: 'send', conversationId, seq: 1,
        iv: bytesToBase64(sealed.iv), ciphertext: bytesToBase64(sealed.ciphertext), signature: bytesToBase64(sealed.signature),
      }));

      // It lands in the database undelivered: nobody was there to take it.
      let page = await h.store.history(conversationId, undefined);
      for (let i = 0; i < 200 && page.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
        page = await h.store.history(conversationId, undefined);
      }
      expect(page).toHaveLength(1);
      expect(page[0]!.deliveredAt).toBeNull();
      const messageId = page[0]!.id;

      // He comes back and asks for history. Handing it to him IS delivery.
      const b2 = openSocket(h.base, bobCookie, roomId);
      await waitFor(() => b2.frames.find((f) => f.t === 'ready'));
      b2.ws.send(JSON.stringify({ t: 'history', conversationId }));

      const delivered = await waitFor(() =>
        a.frames.find((f): f is Extract<ServerMessage, { t: 'receipt' }> => f.t === 'receipt' && f.kind === 'delivered'),
      );
      expect(delivered.messageIds).toEqual([messageId]);

      const after = await h.store.history(conversationId, undefined);
      expect(after[0]!.deliveredAt).toBeGreaterThan(0);
      // Still unread: he has it, he has not reported looking at it.
      expect(after[0]!.readAt).toBeNull();

      a.ws.close();
      b2.ws.close();
    });

    test('a socket is refused for a room the user is not in', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const admin = identityFromMnemonic(generateMnemonicPhrase());
      await bootstrapRoom(h.base, 'admin', admin);
      const outsider = identityFromMnemonic(generateMnemonicPhrase());
      // Outsider makes their own room, then tries to open a socket on admin's.
      const { roomId: ownRoom } = await bootstrapRoom(h.base, 'outsider', outsider);
      const adminCookie = await login(h.base, 'admin', admin);
      const adminRoom = (await (await fetch(`${h.base}/api/rooms`, { headers: { cookie: adminCookie } })).json()).rooms[0].id;
      const outsiderCookie = await login(h.base, 'outsider', outsider);
      const res = await fetch(`${h.base}/ws?room=${adminRoom}`, { headers: { cookie: outsiderCookie, upgrade: 'websocket' } });
      expect(res.status).toBe(403);
      expect(ownRoom).not.toBe(adminRoom);
    });

    test('a non-member is refused when sending into a conversation', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const mallory = identityFromMnemonic(generateMnemonicPhrase());
      const { roomId } = await bootstrapRoom(h.base, 'mallory', mallory);
      const cookie = await login(h.base, 'mallory', mallory);
      const m = openSocket(h.base, cookie, roomId);
      await waitFor(() => m.frames.find((f) => f.t === 'ready'));
      m.ws.send(JSON.stringify({
        t: 'send', conversationId: 'does-not-exist', seq: 1,
        iv: bytesToBase64(new Uint8Array(12)), ciphertext: bytesToBase64(new Uint8Array(20)), signature: bytesToBase64(new Uint8Array(64)),
      }));
      const err = (await waitFor(() => m.frames.find((f) => f.t === 'error'))) as Extract<ServerMessage, { t: 'error' }>;
      expect(err.code).toBe('not_a_member');
      m.ws.close();
    });

    test('a username can only be registered once', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const a = identityFromMnemonic(generateMnemonicPhrase());
      const b = identityFromMnemonic(generateMnemonicPhrase());
      await bootstrapRoom(h.base, 'taken', a);
      const dupe = await fetch(`${h.base}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bootstrap: BOOTSTRAP, username: 'taken', displayName: 'Taken', keys: keysOf(b), vault: FAKE_VAULT }),
      });
      expect(dupe.status).toBe(409);
    });

    test('the sealed vault can be fetched by username, for a new device', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      await bootstrapRoom(h.base, 'vaulter', identityFromMnemonic(generateMnemonicPhrase()));
      const got = await fetch(`${h.base}/api/vault/vaulter`);
      expect(got.status).toBe(200);
      expect((await got.json()).vault).toEqual(FAKE_VAULT);
      const missing = await fetch(`${h.base}/api/vault/nobody`);
      expect(missing.status).toBe(404);
    });

    test('an invite code lets a second account join the same room', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const admin = identityFromMnemonic(generateMnemonicPhrase());
      const { roomId } = await bootstrapRoom(h.base, 'admin', admin);
      const adminCookie = await login(h.base, 'admin', admin);
      const code = await firstRoomCode(h.base, adminCookie);
      const joiner = identityFromMnemonic(generateMnemonicPhrase());
      const { roomId: joinedRoom } = await joinRoom(h.base, 'joiner', joiner, code);
      expect(joinedRoom).toBe(roomId);
      // The joiner now sees that room in their own list.
      const joinerCookie = await login(h.base, 'joiner', joiner);
      const rooms = (await (await fetch(`${h.base}/api/rooms`, { headers: { cookie: joinerCookie } })).json()).rooms;
      expect(rooms.map((r: any) => r.id)).toContain(roomId);
    });

    test('the admin may create unlimited rooms; a member is capped', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const admin = identityFromMnemonic(generateMnemonicPhrase());
      await bootstrapRoom(h.base, 'admin', admin);
      const adminCookie = await login(h.base, 'admin', admin);
      // Admin starts in 1 room; create several more past the per-user cap.
      for (let i = 0; i < MAX_ROOMS_PER_USER + 2; i++) {
        const res = await fetch(`${h.base}/api/rooms`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ name: `room ${i}` }),
        });
        expect(res.status).toBe(200);
      }
      // A member joins, then creates rooms until they hit the cap.
      const code = await firstRoomCode(h.base, adminCookie);
      const member = identityFromMnemonic(generateMnemonicPhrase());
      await joinRoom(h.base, 'member', member, code); // now in 1 room
      const memberCookie = await login(h.base, 'member', member);
      let lastStatus = 200;
      for (let i = 0; i < MAX_ROOMS_PER_USER + 1; i++) {
        const res = await fetch(`${h.base}/api/rooms`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie: memberCookie },
          body: JSON.stringify({ name: `m ${i}` }),
        });
        lastStatus = res.status;
      }
      // Having started in 1 room, the member can create up to the cap, then is refused.
      expect(lastStatus).toBe(403);
    });

    test('rotating a room code invalidates the old one', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const admin = identityFromMnemonic(generateMnemonicPhrase());
      const { roomId } = await bootstrapRoom(h.base, 'admin', admin);
      const adminCookie = await login(h.base, 'admin', admin);
      const oldCode = await firstRoomCode(h.base, adminCookie);
      const rot = await fetch(`${h.base}/api/rooms/${roomId}/rotate`, { method: 'POST', headers: { cookie: adminCookie } });
      expect(rot.status).toBe(200);
      const newCode = (await rot.json()).room.inviteCode as string;
      expect(newCode).not.toBe(oldCode);
      // The old code no longer joins.
      const latecomer = identityFromMnemonic(generateMnemonicPhrase());
      const res = await fetch(`${h.base}/api/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: oldCode, username: 'late', displayName: 'late', keys: keysOf(latecomer), vault: FAKE_VAULT }),
      });
      expect(res.status).toBe(403);
    });

    test('sweepExpired deletes only messages past the cutoff', async () => {
      const store = makeStore();
      await store.init();
      const conv = await store.createConversation({
        roomId: 'r1',
        kind: 'group',
        titleCiphertext: null,
        createdBy: 'u1',
        members: [{ userId: 'u1', wrappedKey: 'QUJD' }],
      });
      await store.appendMessage({ conversationId: conv.id, senderId: 'u1', seq: 1, iv: 'QQ==', ciphertext: 'QQ==', signature: 'QQ==' });
      await store.appendMessage({ conversationId: conv.id, senderId: 'u1', seq: 2, iv: 'QQ==', ciphertext: 'QQ==', signature: 'QQ==' });
      expect(await store.sweepExpired(Date.now() - 1000)).toBe(0);
      expect((await store.history(conv.id, undefined)).length).toBe(2);
      expect(await store.sweepExpired(Date.now() + 1000)).toBe(2);
      expect((await store.history(conv.id, undefined)).length).toBe(0);
    });
  });
}

runSuite('SqliteStore', () => new SqliteStore(':memory:'));
runSuite('TursoStore', () => new TursoStore('file::memory:'));
