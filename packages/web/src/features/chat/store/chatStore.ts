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
import { saveSeen, type Watermarks } from '@/features/chat/unread.ts';
import type { Quote } from '@/features/chat/body.ts';

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
  /** When the author last changed it, or null/absent if never. */
  editedAt?: number | null;
  mine: boolean;
  text: string;
  status: Delivery;
  /** The message this one answers, carried inside the ciphertext. */
  quote?: Quote;
  /** Who wrote it originally, when this message was forwarded. */
  forwardedFrom?: string;
  /** How many others have read it. A count, never a list of names. */
  seenBy?: number;
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
  /**
   * When each conversation was last looked at, per conversation id. Anything
   * newer than the mark, from someone else, is unread. Loaded from this
   * device's storage on connect; never sent anywhere.
   */
  seen: Watermarks;

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
  /** How many people have read these messages of ours. */
  applySeen: (counts: { messageId: string; count: number }[]) => void;
  /** Replace one message's text after its author edited it. */
  applyEdit: (conversationId: string, messageId: string, text: string, editedAt: number) => void;
  setActive: (id: string | null) => void;
  /** Replace the watermarks wholesale, from this device's storage on connect. */
  hydrateSeen: (seen: Watermarks) => void;
  /** Move one conversation's watermark forward. Never backwards. */
  markSeen: (userId: string, conversationId: string, at: number) => void;
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
  seen: {},

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

  applySeen: (counts) =>
    set((s) => {
      const want = new Map(counts.map((c) => [c.messageId, c.count]));
      const next: typeof s.messages = { ...s.messages };
      let touched = false;
      for (const [convId, list] of Object.entries(s.messages)) {
        if (!list.some((m) => want.has(m.id))) continue;
        next[convId] = list.map((m) => {
          const count = want.get(m.id);
          // Only ever up: counts can arrive out of order, and a reader cannot
          // un-read a message.
          return count !== undefined && count > (m.seenBy ?? 0) ? { ...m, seenBy: count } : m;
        });
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

  applyEdit: (conversationId, messageId, text, editedAt) =>
    set((s) => {
      const list = s.messages[conversationId];
      if (!list?.some((m) => m.id === messageId)) return s;
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => (m.id === messageId ? { ...m, text, editedAt } : m)),
        },
      };
    }),

  setActive: (activeId) => set({ activeId }),

  hydrateSeen: (seen) => set({ seen }),

  markSeen: (userId, conversationId, at) =>
    set((s) => {
      // Only ever forward: a late history page carrying older messages must not
      // drag the mark back and make read things unread again.
      if ((s.seen[conversationId] ?? 0) >= at) return s;
      const seen = { ...s.seen, [conversationId]: at };
      saveSeen(userId, seen);
      return { seen };
    }),

  // The watermarks survive a reset: they describe what this person has read,
  // which does not change because the socket reopened on another room.
  reset: () => set({ connection: 'connecting', users: {}, conversations: {}, messages: {}, typing: {}, online: [], activeId: null }),
}));
