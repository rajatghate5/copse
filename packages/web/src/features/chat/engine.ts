/**
 * The chat engine - the glue between the socket, the crypto, the outbox and the
 * store. Kept out of React so it can run on connect/reconnect without a
 * component in the loop. Hooks just start it and call `sendText`.
 *
 * It reads the current identity and key manager from the auth store and the
 * live data from the chat store via getState(), so there are no props to thread
 * through and no stale closures.
 */

import type { ServerMessage, ConversationKind, WireMessage } from '@copse/protocol';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { useChatStore, statusOf, type ChatMessage } from '@/features/chat/store/chatStore.ts';
import { SocketService } from '@/features/chat/services/socket.ts';
import { dequeue, enqueue, pending } from '@/lib/idb.ts';
import { notifyMessage } from '@/features/chat/notify.ts';
import { mentions } from '@/features/chat/mentions.ts';
import { decodeBody, encodeBody, type Body } from '@/features/chat/body.ts';
import { lastConversation, rememberConversation, rememberRoom } from '@/features/chat/place.ts';
import { loadSeen } from '@/features/chat/unread.ts';

export const socket = new SocketService();

/** Connect to one room and route every frame. Safe to call again after sign-out. */
export function startEngine(roomId: string): void {
  socket.setRoom(roomId);
  socket.connect({
    onState: (state) => {
      useChatStore.getState().setConnection(state);
      if (state === 'online') void flushOutbox();
    },
    onMessage: (msg) => void handleFrame(msg),
  });
}

/** Leave the current room and reconnect scoped to another one. */
export function switchRoom(roomId: string): void {
  if (useRoomStore.getState().currentRoomId === roomId) return;
  useRoomStore.getState().setCurrent(roomId);
  const me = useAuth.getState().me;
  if (me) rememberRoom(me.id, roomId);
  // A room is a sealed world: drop the old room's directory, conversations and
  // messages so nothing bleeds across, then reopen the socket into the new one.
  useChatStore.getState().reset();
  socket.setRoom(roomId);
  socket.reopen();
}

export function stopEngine(): void {
  socket.close();
  useChatStore.getState().reset();
  useRoomStore.getState().reset();
}

async function handleFrame(msg: ServerMessage): Promise<void> {
  const store = useChatStore.getState();
  const { km, me } = useAuth.getState();
  if (!km || !me) return;

  switch (msg.t) {
    case 'hello':
      return;

    case 'ready': {
      // The server's identity summary is authoritative (it carries the admin flag).
      useAuth.getState().setMe(msg.you);
      useRoomStore.getState().setRooms(msg.rooms);
      useRoomStore.getState().setCurrent(msg.room.id);
      store.applyReady(msg.users, msg.conversations);
      // What this device has already read, so the roster does not light up every
      // conversation on every connect.
      store.hydrateSeen(loadSeen(me.id));
      rememberRoom(me.id, msg.room.id);
      // Reopen the thread this account left open here. The remembered id is only
      // ever a hint: it opens if the server just listed it, and is otherwise
      // dropped, so a deleted conversation lands on the roster rather than on a
      // thread that cannot exist.
      const wanted = lastConversation(me.id, msg.room.id);
      if (wanted && msg.conversations.some((c) => c.id === wanted)) {
        store.setActive(wanted);
      }
      return;
    }

    case 'user':
      store.addUser(msg.user);
      return;

    case 'conversation': {
      store.addConversation(msg.conversation);
      // The store opens the first conversation to appear when nothing is open.
      // Keep the memory in step with what is on screen, so a reload right after
      // starting a chat comes back to that chat.
      const roomId = useRoomStore.getState().currentRoomId;
      if (roomId && useChatStore.getState().activeId === msg.conversation.id) {
        rememberConversation(me.id, roomId, msg.conversation.id);
      }
      return;
    }

    case 'key': {
      await km.acceptWrappedKey(msg.conversationId, msg.wrappedKey);
      // Now that we can read this conversation, pull its recent history.
      socket.send({ t: 'history', conversationId: msg.conversationId });
      return;
    }

    case 'message': {
      const wire = msg.message;
      if (wire.senderId === me.id) {
        // Our own message echoed back: reconcile the optimistic bubble.
        const list = store.messages[wire.conversationId] ?? [];
        const opt = list.find((m) => m.mine && m.seq === wire.seq && m.status === 'pending');
        const text = opt?.text ?? decodeBody((await tryDecrypt(wire, me.keys.sigPub)) ?? '').text;
        if (opt) await dequeue(opt.id);
        store.reconcile(wire, text);
        return;
      }
      const sender = store.users[wire.senderId];
      if (!sender) return;
      const plaintext = await tryDecrypt(wire, sender.keys.sigPub);
      if (plaintext === null) return; // no key yet; history will bring it after 'key'
      const body = decodeBody(plaintext);
      store.addMessage(toMessage(wire, body, false));
      // After the message is in the store, so clicking through finds it there.
      // The mention is found here, on the decrypted text: the server cannot see
      // who was named and so could never have told anyone.
      notifyMessage(sender.displayName, wire.conversationId, mentions(body.text, me.username));
      return;
    }

    case 'edited': {
      const wire = msg.message;
      const sender = store.users[wire.senderId];
      const sigPub = wire.senderId === me.id ? me.keys.sigPub : sender?.keys.sigPub;
      if (!sigPub) return;
      const plaintext = await tryDecrypt(wire, sigPub);
      // A body that will not open is left as it was: better the old text than a
      // blank bubble, and the signature is what refused it.
      if (plaintext === null) return;
      store.applyEdit(wire.conversationId, wire.id, decodeBody(plaintext).text, wire.editedAt ?? Date.now());
      return;
    }

    case 'history': {
      const decrypted: ChatMessage[] = [];
      for (const wire of msg.messages) {
        const sender = store.users[wire.senderId];
        const sigPub = wire.senderId === me.id ? me.keys.sigPub : sender?.keys.sigPub;
        if (!sigPub) continue;
        const plaintext = await tryDecrypt(wire, sigPub);
        if (plaintext !== null) decrypted.push(toMessage(wire, decodeBody(plaintext), wire.senderId === me.id));
      }
      store.prependHistory(msg.conversationId, decrypted);
      return;
    }

    case 'typing':
      store.setTyping(msg.state.conversationId, msg.state.userId, msg.state.typing);
      return;

    case 'presence':
      store.setOnline(msg.userIds);
      return;

    case 'receipt':
      store.applyReceipt(msg.messageIds, msg.kind);
      return;

    case 'error':
      // Non-fatal; the UI shows connection state, and illegal actions are rare.
      console.warn('[copse] server error:', msg.code, msg.message);
      return;
  }
}

function toMessage(
  wire: WireMessage,
  body: Body,
  mine: boolean,
): ChatMessage {
  return {
    id: wire.id,
    conversationId: wire.conversationId,
    senderId: wire.senderId,
    seq: wire.seq,
    sentAt: wire.sentAt,
    editedAt: wire.editedAt,
    mine,
    text: body.text,
    quote: body.quote,
    forwardedFrom: body.forwardedFrom,
    status: statusOf(wire),
  };
}

async function tryDecrypt(
  wire: { conversationId: string; senderId: string; seq: number; iv: string; ciphertext: string; signature: string },
  senderSigPub: string,
): Promise<string | null> {
  const km = useAuth.getState().km!;
  try {
    return await km.decrypt(wire, senderSigPub);
  } catch {
    // A signature or auth failure: drop it rather than render forged content.
    return null;
  }
}

/**
 * Seal, optimistically show, persist to the outbox, and send one message.
 *
 * `body` may carry a quoted reply or a forward attribution; both are sealed
 * inside the ciphertext, so sending one is an ordinary send as far as the server
 * is concerned - it never learns that this message answers that one.
 */
export async function sendText(conversationId: string, text: string, extra?: Omit<Body, 'text'>): Promise<void> {
  const { km, me } = useAuth.getState();
  if (!km || !me) return;
  const body: Body = { text, ...extra };
  const enc = await km.encrypt(conversationId, me.id, encodeBody(body));
  if (!enc) return; // no conversation key yet

  const clientId = crypto.randomUUID();
  const optimistic: ChatMessage = {
    id: clientId,
    conversationId,
    senderId: me.id,
    seq: enc.seq,
    sentAt: Date.now(),
    mine: true,
    text,
    quote: body.quote,
    forwardedFrom: body.forwardedFrom,
    status: 'pending',
  };
  useChatStore.getState().addOptimistic(optimistic);
  // The outbox keeps the encoded body, so a resend is byte-identical to what
  // was sealed; flushOutbox decodes it again to redraw the bubble.
  await enqueue({ clientId, conversationId, seq: enc.seq, iv: enc.iv, ciphertext: enc.ciphertext, signature: enc.signature, plaintext: encodeBody(body), createdAt: Date.now() });
  socket.send({ t: 'send', conversationId, seq: enc.seq, iv: enc.iv, ciphertext: enc.ciphertext, signature: enc.signature });
}

/**
 * Open a conversation and remember it as this account's place in this room, so a
 * reload comes back to it. The store and the memory move together - a thread
 * opened without going through here would be forgotten on refresh.
 */
export function openConversation(conversationId: string): void {
  useChatStore.getState().setActive(conversationId);
  const me = useAuth.getState().me;
  const roomId = useRoomStore.getState().currentRoomId;
  if (me && roomId) rememberConversation(me.id, roomId, conversationId);
}

/**
 * Replace the text of a message we sent. Sealed here at the original seq, since
 * that is what the signature covers; the server checks only that the message is
 * ours, and still cannot read either version.
 *
 * The local message is updated when the server's `edited` frame comes back
 * rather than optimistically: an edit that is refused should leave what everyone
 * else can still see.
 */
export async function editText(conversationId: string, messageId: string, seq: number, text: string): Promise<void> {
  const { km, me } = useAuth.getState();
  if (!km || !me) return;
  const existing = (useChatStore.getState().messages[conversationId] ?? []).find((m) => m.id === messageId);
  if (!existing) return;
  // Keep whatever the message already carried - editing the words of a reply
  // must not silently drop what it was replying to.
  const enc = await km.encryptAt(conversationId, me.id, seq, encodeBody({
    text,
    quote: existing.quote,
    forwardedFrom: existing.forwardedFrom,
  }));
  if (!enc) return;
  socket.send({ t: 'edit', conversationId, messageId, iv: enc.iv, ciphertext: enc.ciphertext, signature: enc.signature });
}

/**
 * Send one message into another conversation, attributed to whoever wrote it.
 *
 * It is a new message, not a moved one: it is sealed with the target
 * conversation's key, by us, so it carries our name as the sender and the
 * original author's as the attribution. It cannot inherit the original's ticks,
 * because those were about a different audience.
 */
export async function forwardText(toConversationId: string, message: ChatMessage): Promise<void> {
  const users = useChatStore.getState().users;
  const me = useAuth.getState().me;
  if (!me) return;
  // Whoever it was already attributed to, if this is a forward of a forward -
  // otherwise the person who wrote it.
  const origin = message.forwardedFrom
    ?? (message.mine ? me.displayName : users[message.senderId]?.displayName ?? 'someone');
  await sendText(toConversationId, message.text, { forwardedFrom: origin });
}

/** Create a direct or group conversation with the given other members. */
export async function createConversation(kind: ConversationKind, otherUserIds: string[]): Promise<void> {
  const { km, me } = useAuth.getState();
  const users = useChatStore.getState().users;
  if (!km || !me) return;

  const memberIds = [me.id, ...otherUserIds.filter((id) => id !== me.id)];
  const members = memberIds
    .map((id) => (id === me.id ? { userId: me.id, encPub: me.keys.encPub } : users[id] && { userId: id, encPub: users[id]!.keys.encPub }))
    .filter(Boolean) as { userId: string; encPub: string }[];

  const { wrapped } = await km.newConversationKeys(members);
  socket.send({ t: 'createConversation', kind, titleCiphertext: null, members: wrapped });
  // Our own wrapped key comes back as a 'key' frame and unwraps to the same key.
}

/**
 * Add people to a conversation we are already in. The key is wrapped here, on
 * this device, because it exists nowhere else - and it is the same key, so they
 * will be able to read the thread as it already stands.
 */
export async function addMembers(conversationId: string, newUserIds: string[]): Promise<void> {
  const { km, me } = useAuth.getState();
  const users = useChatStore.getState().users;
  const conv = useChatStore.getState().conversations[conversationId];
  if (!km || !me || !conv) return;

  const already = new Set(conv.memberIds);
  const members = newUserIds
    .filter((id) => !already.has(id) && users[id])
    .map((id) => ({ userId: id, encPub: users[id]!.keys.encPub }));
  if (members.length === 0) return;

  const wrapped = await km.wrapExistingKeyFor(conversationId, members);
  if (!wrapped) return; // no key for this conversation yet; nothing to hand over
  socket.send({ t: 'addMembers', conversationId, members: wrapped });
}

/** On (re)connect, resend anything queued while offline. */
async function flushOutbox(): Promise<void> {
  const items = await pending();
  const store = useChatStore.getState();
  for (const item of items) {
    // Re-show it if this is a fresh session that lost the optimistic bubble.
    const known = (store.messages[item.conversationId] ?? []).some((m) => m.id === item.clientId || (m.mine && m.seq === item.seq));
    if (!known) {
      const body = decodeBody(item.plaintext);
      store.addOptimistic({
        id: item.clientId, conversationId: item.conversationId, senderId: useAuth.getState().me!.id,
        seq: item.seq, sentAt: item.createdAt, mine: true, text: body.text,
        quote: body.quote, forwardedFrom: body.forwardedFrom, status: 'pending',
      });
    }
    socket.send({ t: 'send', conversationId: item.conversationId, seq: item.seq, iv: item.iv, ciphertext: item.ciphertext, signature: item.signature });
  }
}

/** Debounced typing signal for the active conversation. */
let typingTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Report messages this client has displayed. Ids already reported are dropped,
 * so scrolling a thread does not re-send the same receipt every render.
 */
const reported = new Set<string>();
export function markRead(conversationId: string, messageIds: string[]): void {
  const fresh = messageIds.filter((id) => !reported.has(id));
  if (fresh.length === 0) return;
  for (const id of fresh) reported.add(id);
  socket.send({ t: 'read', conversationId, messageIds: fresh });
}

export function signalTyping(conversationId: string): void {
  socket.send({ t: 'typing', conversationId, typing: true });
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.send({ t: 'typing', conversationId, typing: false }), 2500);
}
