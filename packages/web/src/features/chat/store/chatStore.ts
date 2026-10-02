/**
 * The realtime store. This is where fast-changing data lives - incoming
 * messages, typing flags, connection state - deliberately in Zustand and NOT in
 * React Context, so a new message re-renders the thread it belongs to, never the
 * whole app.
 *
 * The store is plaintext-facing: messages arrive here already decrypted (the
 * socket layer does that), so components read `.text` directly. Delivery status
 * is reconciled by matching a server echo to the optimistic message on
 * (conversationId, senderId, seq).
 */

import { create } from 'zustand';
import type { ConversationSummary, UserSummary, WireMessage } from '@copse/protocol';

export type Delivery = 'pending' | 'sent' | 'delivered' | 'read';

/** Rank, so a late `delivered` can never undo a `read` that already landed. */
const RANK: Record<Delivery, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * What the server's stamps mean for a tick. Both are "first by anyone other
 * than the sender", so this is the status of the message, not of one reader.
 */
export function statusOf(wire: { deliveredAt: number | null; readAt: number | null }): Delivery {
  if (wire.readAt !== null) return 'read';
  if (wire.deliveredAt !== null) return 'delivered';
  return 'sent';
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  seq: number;
  sentAt: number;
  mine: boolean;
  text: string;
  status: Delivery;
  /** Set while an unreadable message waits for its key. */
  locked?: boolean;
}

export type Connection = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface ChatState {
  connection: Connection;
  users: Record<string, UserSummary>;
  conversations: Record<string, ConversationSummary>;
  messages: Record<string, ChatMessage[]>;
  typing: Record<string, string[]>; // conversationId -> userIds typing
  /** Room members with a live socket, as the server last reported them. */
  online: string[];
  activeId: string | null;

  setConnection: (c: Connection) => void;
  applyReady: (users: UserSummary[], conversations: ConversationSummary[]) => void;
  addUser: (u: UserSummary) => void;
  addConversation: (c: ConversationSummary) => void;
  addMessage: (m: ChatMessage) => void;
  addOptimistic: (m: ChatMessage) => void;
  reconcile: (echo: WireMessage, text: string) => void;
  prependHistory: (conversationId: string, msgs: ChatMessage[]) => void;
  setTyping: (conversationId: string, userId: string, typing: boolean) => void;
  setOnline: (userIds: string[]) => void;
  applyReceipt: (messageIds: string[], kind: 'delivered' | 'read') => void;
  setActive: (id: string | null) => void;
  reset: () => void;
}

function insertSorted(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (list.some((x) => x.id === m.id)) return list;
  const next = [...list, m];
  next.sort((a, b) => a.sentAt - b.sentAt);
  return next;
}

export const useChatStore = create<ChatState>((set) => ({
  connection: 'connecting',
  users: {},
  conversations: {},
  messages: {},
  typing: {},
  online: [],
  activeId: null,

  setConnection: (connection) => set({ connection }),
  // The server sends the whole list, so replacing it wholesale is the point.
  setOnline: (online) => set({ online }),

  applyReceipt: (messageIds, kind) =>
    set((s) => {
      const wanted = new Set(messageIds);
      const next: typeof s.messages = { ...s.messages };
      let touched = false;
      for (const [convId, list] of Object.entries(s.messages)) {
        if (!list.some((m) => wanted.has(m.id))) continue;
        next[convId] = list.map((m) =>
          // Never downgrade: receipts can arrive out of order.
          wanted.has(m.id) && RANK[kind] > RANK[m.status] ? { ...m, status: kind } : m,
        );
        touched = true;
      }
      return touched ? { messages: next } : s;
    }),

  applyReady: (users, conversations) =>
    set({
      users: Object.fromEntries(users.map((u) => [u.id, u])),
      conversations: Object.fromEntries(conversations.map((c) => [c.id, c])),
    }),

  addUser: (u) => set((s) => ({ users: { ...s.users, [u.id]: u } })),

  addConversation: (c) =>
    set((s) => ({
      conversations: { ...s.conversations, [c.id]: c },
      // Default the active conversation to the first one that appears.
      activeId: s.activeId ?? c.id,
    })),

  addMessage: (m) =>
    set((s) => ({ messages: { ...s.messages, [m.conversationId]: insertSorted(s.messages[m.conversationId] ?? [], m) } })),

  addOptimistic: (m) =>
    set((s) => ({ messages: { ...s.messages, [m.conversationId]: [...(s.messages[m.conversationId] ?? []), m] } })),

  reconcile: (echo, text) =>
    set((s) => {
      const list = s.messages[echo.conversationId] ?? [];
      // Find the optimistic twin: mine, same seq, still pending.
      const idx = list.findIndex((x) => x.mine && x.seq === echo.seq && x.status === 'pending');
      if (idx === -1) {
        // No optimistic twin (another tab, or a fresh load): just add it.
        return { messages: { ...s.messages, [echo.conversationId]: insertSorted(list, {
          id: echo.id, conversationId: echo.conversationId, senderId: echo.senderId, seq: echo.seq,
          sentAt: echo.sentAt, mine: true, text, status: statusOf(echo),
        }) } };
      }
      const next = list.slice();
      next[idx] = { ...next[idx]!, id: echo.id, sentAt: echo.sentAt, status: statusOf(echo) };
      return { messages: { ...s.messages, [echo.conversationId]: next } };
    }),

  prependHistory: (conversationId, msgs) =>
    set((s) => {
      const have = new Set((s.messages[conversationId] ?? []).map((m) => m.id));
      const merged = [...msgs.filter((m) => !have.has(m.id)), ...(s.messages[conversationId] ?? [])];
      merged.sort((a, b) => a.sentAt - b.sentAt);
      return { messages: { ...s.messages, [conversationId]: merged } };
    }),

  setTyping: (conversationId, userId, typing) =>
    set((s) => {
      const cur = new Set(s.typing[conversationId] ?? []);
      if (typing) cur.add(userId); else cur.delete(userId);
      return { typing: { ...s.typing, [conversationId]: [...cur] } };
    }),

  setActive: (activeId) => set({ activeId }),

  reset: () => set({ connection: 'connecting', users: {}, conversations: {}, messages: {}, typing: {}, online: [], activeId: null }),
}));
