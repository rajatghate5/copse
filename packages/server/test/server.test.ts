/**
 * End-to-end server tests, run against BOTH storage backends so the two never
 * drift. Each spins up a real Bun.serve on an ephemeral port, registers two
 * users with real keypairs, logs them in by signing the challenge, opens
 * WebSockets, and exchanges a genuinely encrypted message.
 *
 * The decisive assertion is that what the server stores and forwards is
 * ciphertext: the second user decrypts it with the conversation key, and the
 * raw frame never contains the plaintext.
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
  type ServerMessage,
  type UserSummary,
} from '@copse/protocol';
import { createServer } from '../src/server.ts';
import { SqliteStore } from '../src/store-sqlite.ts';
import { TursoStore } from '../src/store-turso.ts';
import type { Store } from '../src/store.ts';

const INVITE = 'test-invite';

interface Harness {
  base: string;
  server: AnyServer;
}

async function startServer(store: Store): Promise<Harness> {
  await store.init();
  const app = createServer({ store, invite: INVITE });
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  return { base: `http://localhost:${server.port}`, server };
}

// A throwaway vault blob. Its parts only need to look like base64; these tests
// never unlock it (that is covered in the crypto suite).
const FAKE_VAULT = { salt: 'QUJD', iv: 'QUJD', ciphertext: 'QUJDRA==' };

async function register(base: string, username: string, id: Identity): Promise<string> {
  const pub = publicIdentity(id);
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invite: INVITE,
      username,
      displayName: username,
      keys: { encPub: bytesToBase64(pub.encPub), sigPub: bytesToBase64(pub.sigPub) },
      vault: FAKE_VAULT,
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).userId as string;
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

/** Open an authenticated socket and collect frames as they arrive. */
function openSocket(base: string, cookie: string): { ws: WebSocket; frames: ServerMessage[] } {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } } as any);
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

    test('rejects a socket with no session', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const res = await fetch(`${h.base}/ws`, { headers: { upgrade: 'websocket' } });
      expect(res.status).toBe(401);
    });

    test('rejects registration with a bad invite', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const pub = publicIdentity(alice);
      const res = await fetch(`${h.base}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'alice',
          invite: 'wrong',
          keys: { encPub: bytesToBase64(pub.encPub), sigPub: bytesToBase64(pub.sigPub) },
        }),
      });
      expect(res.status).toBe(403);
    });

    test('rejects login with a signature from the wrong key', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const imposter = identityFromMnemonic(generateMnemonicPhrase());
      const aliceId = await register(h.base, 'alice', alice);
      const ch = await fetch(`${h.base}/api/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice' }),
      });
      const { challenge } = await ch.json();
      // Sign with the imposter's key; the server checks against alice's.
      const signature = signChallenge(challenge, imposter.sigPriv);
      const res = await fetch(`${h.base}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', challenge, signature }),
      });
      expect(res.status).toBe(401);
    });

    test('two users exchange an end-to-end encrypted message', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);

      const alice = identityFromMnemonic(generateMnemonicPhrase());
      const bob = identityFromMnemonic(generateMnemonicPhrase());
      const aliceId = await register(h.base, 'alice', alice);
      const bobId = await register(h.base, 'bob', bob);

      const aliceCookie = await login(h.base, 'alice', alice);
      const bobCookie = await login(h.base, 'bob', bob);

      const a = openSocket(h.base, aliceCookie);
      const b = openSocket(h.base, bobCookie);

      // Both sockets receive `ready` with the roster including each other.
      const aReady = await waitFor(() => a.frames.find((f) => f.t === 'ready')) as Extract<ServerMessage, { t: 'ready' }>;
      await waitFor(() => b.frames.find((f) => f.t === 'ready'));
      const bobSummary = aReady.users.find((u: UserSummary) => u.id === bobId)!;
      expect(bobSummary).toBeTruthy();

      // Alice makes a conversation key and wraps it for both members.
      const convKey = generateConversationKey();
      const wrapForAlice = packWrappedKey(await wrapKeyFor(convKey, alice.encPub));
      const wrapForBob = packWrappedKey(await wrapKeyFor(convKey, base64ToBytes(bobSummary.keys.encPub)));

      a.ws.send(JSON.stringify({
        t: 'createConversation',
        kind: 'direct',
        titleCiphertext: null,
        members: [
          { userId: aliceId, wrappedKey: wrapForAlice },
          { userId: bobId, wrappedKey: wrapForBob },
        ],
      }));

      // Bob receives the conversation and his own wrapped key, and unwraps it.
      const bConv = await waitFor(() => b.frames.find((f) => f.t === 'conversation')) as Extract<ServerMessage, { t: 'conversation' }>;
      const bKey = await waitFor(() => b.frames.find((f) => f.t === 'key')) as Extract<ServerMessage, { t: 'key' }>;
      const bobConvKey = await unwrapKey(unpackWrappedKey(bKey.wrappedKey), bob.encPriv);
      expect(bytesToBase64(bobConvKey)).toBe(bytesToBase64(convKey));

      // Alice seals a message and sends it.
      const ctx = { conversationId: bConv.conversation.id, senderId: aliceId, seq: 1 };
      const sealed = await sealMessage(convKey, alice.sigPriv, ctx, utf8ToBytes('hello bob'));
      const cleanFrames = b.frames.length;
      a.ws.send(JSON.stringify({
        t: 'send',
        conversationId: ctx.conversationId,
        seq: 1,
        iv: bytesToBase64(sealed.iv),
        ciphertext: bytesToBase64(sealed.ciphertext),
        signature: bytesToBase64(sealed.signature),
      }));

      const bMsg = await waitFor(() => b.frames.slice(cleanFrames).find((f) => f.t === 'message')) as Extract<ServerMessage, { t: 'message' }>;
      // The forwarded frame is ciphertext, not the plaintext.
      expect(bMsg.message.ciphertext).not.toContain('hello');
      expect(JSON.stringify(bMsg.message)).not.toContain('hello bob');

      // Bob opens it with the unwrapped key and Alice's signing key.
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

    test('a non-member is refused when sending into a conversation', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const mallory = identityFromMnemonic(generateMnemonicPhrase());
      const malloryId = await register(h.base, 'mallory', mallory);
      const cookie = await login(h.base, 'mallory', mallory);
      const m = openSocket(h.base, cookie);
      await waitFor(() => m.frames.find((f) => f.t === 'ready'));
      m.ws.send(JSON.stringify({
        t: 'send',
        conversationId: 'does-not-exist',
        seq: 1,
        iv: bytesToBase64(new Uint8Array(12)),
        ciphertext: bytesToBase64(new Uint8Array(20)),
        signature: bytesToBase64(new Uint8Array(64)),
      }));
      const err = await waitFor(() => m.frames.find((f) => f.t === 'error')) as Extract<ServerMessage, { t: 'error' }>;
      expect(err.code).toBe('not_a_member');
      m.ws.close();
    });

    test('a username can only be registered once', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const a = identityFromMnemonic(generateMnemonicPhrase());
      const b = identityFromMnemonic(generateMnemonicPhrase());
      await register(h.base, 'taken', a);
      const dupe = await fetch(`${h.base}/api/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invite: INVITE, username: 'taken', displayName: 'Taken',
          keys: { encPub: bytesToBase64(publicIdentity(b).encPub), sigPub: bytesToBase64(publicIdentity(b).sigPub) },
          vault: FAKE_VAULT,
        }),
      });
      expect(dupe.status).toBe(409);
    });

    test('the sealed vault can be fetched by username, for a new device', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      await register(h.base, 'vaulter', identityFromMnemonic(generateMnemonicPhrase()));
      const got = await fetch(`${h.base}/api/vault/vaulter`);
      expect(got.status).toBe(200);
      expect((await got.json()).vault).toEqual(FAKE_VAULT);
      const missing = await fetch(`${h.base}/api/vault/nobody`);
      expect(missing.status).toBe(404);
    });

    test('the invite code is revealed only to a logged-in member', async () => {
      const h = await startServer(makeStore());
      servers.push(h.server);
      const id = identityFromMnemonic(generateMnemonicPhrase());
      await register(h.base, 'member', id);
      const anon = await fetch(`${h.base}/api/invite`);
      expect(anon.status).toBe(401);
      const cookie = await login(h.base, 'member', id);
      const ok = await fetch(`${h.base}/api/invite`, { headers: { cookie } });
      expect(ok.status).toBe(200);
      expect((await ok.json()).invite).toBe(INVITE);
    });

    test('sweepExpired deletes only messages past the cutoff', async () => {
      const store = makeStore();
      await store.init();
      const conv = await store.createConversation({
        kind: 'group',
        titleCiphertext: null,
        createdBy: 'u1',
        members: [{ userId: 'u1', wrappedKey: 'QUJD' }],
      });
      // Two messages land "now"; a sweep with a cutoff in the past keeps both.
      await store.appendMessage({ conversationId: conv.id, senderId: 'u1', seq: 1, iv: 'QQ==', ciphertext: 'QQ==', signature: 'QQ==' });
      await store.appendMessage({ conversationId: conv.id, senderId: 'u1', seq: 2, iv: 'QQ==', ciphertext: 'QQ==', signature: 'QQ==' });
      expect(await store.sweepExpired(Date.now() - 1000)).toBe(0);
      expect((await store.history(conv.id, undefined)).length).toBe(2);
      // A cutoff in the future is past both timestamps, so both are deleted.
      expect(await store.sweepExpired(Date.now() + 1000)).toBe(2);
      expect((await store.history(conv.id, undefined)).length).toBe(0);
    });
  });
}

runSuite('SqliteStore', () => new SqliteStore(':memory:'));
runSuite('TursoStore', () => new TursoStore('file::memory:'));
