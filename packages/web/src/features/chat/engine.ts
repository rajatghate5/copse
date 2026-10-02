/**
 * The chat engine - the glue between the socket, the crypto, the outbox and the
 * store. Kept out of React so it can run on connect/reconnect without a
 * component in the loop. Hooks just start it and call `sendText`.
 *
 * It reads the current identity and key manager from the auth store and the
 * live data from the chat store via getState(), so there are no props to thread
 * through and no stale closures.
 */

import type { ServerMessage, ConversationKind } from '@copse/protocol';
import { useAuth } from '@/features/auth/authStore.ts';
import { useRoomStore } from '@/features/rooms/roomStore.ts';
import { useChatStore, type ChatMessage } from '@/features/chat/store/chatStore.ts';
import { SocketService } from '@/features/chat/services/socket.ts';
import { dequeue, enqueue, pending } from '@/lib/idb.ts';

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

    case 'ready':
      // The server's identity summary is authoritative (it carries the admin flag).
      useAuth.getState().setMe(msg.you);
      useRoomStore.getState().setRooms(msg.rooms);
      useRoomStore.getState().setCurrent(msg.room.id);
      store.applyReady(msg.users, msg.conversations);
      return;

    case 'user':
      store.addUser(msg.user);
      return;

    case 'conversation':
      store.addConversation(msg.conversation);
      return;

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
        const text = opt?.text ?? (await tryDecrypt(wire, me.keys.sigPub)) ?? '';
        if (opt) await dequeue(opt.id);
        store.reconcile(wire, text);
        return;
      }
      const sender = store.users[wire.senderId];
      if (!sender) return;
      const text = await tryDecrypt(wire, sender.keys.sigPub);
      if (text === null) return; // no key yet; history will bring it after 'key'
      store.addMessage(toMessage(wire, text, false));
      return;
    }

    case 'history': {
      const decrypted: ChatMessage[] = [];
      for (const wire of msg.messages) {
        const sender = store.users[wire.senderId];
        const sigPub = wire.senderId === me.id ? me.keys.sigPub : sender?.keys.sigPub;
        if (!sigPub) continue;
        const text = await tryDecrypt(wire, sigPub);
        if (text !== null) decrypted.push(toMessage(wire, text, wire.senderId === me.id));
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

    case 'error':
      // Non-fatal; the UI shows connection state, and illegal actions are rare.
      console.warn('[copse] server error:', msg.code, msg.message);
      return;
  }
}

function toMessage(
  wire: { id: string; conversationId: string; senderId: string; seq: number; sentAt: number },
  text: string,
  mine: boolean,
): ChatMessage {
  return {
    id: wire.id,
    conversationId: wire.conversationId,
    senderId: wire.senderId,
    seq: wire.seq,
    sentAt: wire.sentAt,
    mine,
    text,
    status: 'sent',
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

/** Seal, optimistically show, persist to the outbox, and send one message. */
export async function sendText(conversationId: string, text: string): Promise<void> {
  const { km, me } = useAuth.getState();
  if (!km || !me) return;
  const enc = await km.encrypt(conversationId, me.id, text);
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
    status: 'pending',
  };
  useChatStore.getState().addOptimistic(optimistic);
  await enqueue({ clientId, conversationId, seq: enc.seq, iv: enc.iv, ciphertext: enc.ciphertext, signature: enc.signature, plaintext: text, createdAt: Date.now() });
  socket.send({ t: 'send', conversationId, seq: enc.seq, iv: enc.iv, ciphertext: enc.ciphertext, signature: enc.signature });
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

/** On (re)connect, resend anything queued while offline. */
async function flushOutbox(): Promise<void> {
  const items = await pending();
  const store = useChatStore.getState();
  for (const item of items) {
    // Re-show it if this is a fresh session that lost the optimistic bubble.
    const known = (store.messages[item.conversationId] ?? []).some((m) => m.id === item.clientId || (m.mine && m.seq === item.seq));
    if (!known) {
      store.addOptimistic({
        id: item.clientId, conversationId: item.conversationId, senderId: useAuth.getState().me!.id,
        seq: item.seq, sentAt: item.createdAt, mine: true, text: item.plaintext, status: 'pending',
      });
    }
    socket.send({ t: 'send', conversationId: item.conversationId, seq: item.seq, iv: item.iv, ciphertext: item.ciphertext, signature: item.signature });
  }
}

/** Debounced typing signal for the active conversation. */
let typingTimer: ReturnType<typeof setTimeout> | null = null;
export function signalTyping(conversationId: string): void {
  socket.send({ t: 'typing', conversationId, typing: true });
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.send({ t: 'typing', conversationId, typing: false }), 2500);
}
