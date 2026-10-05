/**
 * Hosted storage via libSQL / Turso. This is the backend used on Render, whose
 * free tier cannot attach a disk, so a local file would vanish on every restart.
 *
 * Turso stores only ciphertext and public keys - the same rows as the local
 * backend - so putting data on a third party's servers leaks nothing readable.
 *
 * `@libsql/client` is fully async, which is the reason the Store interface is
 * async at all. Rows come back as objects keyed by column name, matching the
 * shared mappers in store.ts.
 */

import { createClient, type Client } from '@libsql/client';
import type {
  ConversationSummary,
  MemberKey,
  RoomSummary,
  UserSummary,
  VaultBlob,
  WireMessage,
} from '@copse/protocol';
import {
  ADD_MEMBER_SQL,
  ADD_READ_SQL,
  EDIT_MESSAGE_SQL,
  HISTORY_PAGE,
  MIGRATIONS,
  PROMOTE_TO_GROUP_SQL,
  RETENTION_MS,
  SCHEMA,
  newId,
  markSql,
  rowToMessage,
  rowToRoom,
  rowToUser,
  seenCountSql,
  SWEEP_READS_SQL,
  type NewConversation,
  type NewMessage,
  type NewRoom,
  type NewUser,
  type Store,
} from './store.ts';

export class TursoStore implements Store {
  private db: Client;

  constructor(url: string, authToken?: string) {
    this.db = createClient({ url, authToken });
  }

  async init(): Promise<void> {
    // Migrate first: add columns a pre-rooms database lacks, so the schema's
    // room_id index can be created. On a fresh database these ALTERs hit a
    // missing table and are ignored; SCHEMA then creates everything correctly.
    for (const sql of MIGRATIONS) {
      try { await this.db.execute(sql); } catch { /* table absent (fresh) or column present */ }
    }
    // The schema is several statements; executeMultiple runs them as one script.
    await this.db.executeMultiple(SCHEMA);
  }

  async createUser(u: NewUser): Promise<UserSummary> {
    const id = newId();
    const isAdmin = u.isAdmin ? 1 : 0;
    await this.db.execute({
      sql: 'INSERT INTO users (id, username, display_name, enc_pub, sig_pub, vault_salt, vault_iv, vault_ct, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, u.username, u.displayName, u.encPub, u.sigPub, u.vault.salt, u.vault.iv, u.vault.ciphertext, isAdmin, Date.now()],
    });
    return {
      id,
      username: u.username,
      displayName: u.displayName,
      keys: { encPub: u.encPub, sigPub: u.sigPub },
      isAdmin: Boolean(isAdmin),
    };
  }

  async getUser(id: string): Promise<UserSummary | null> {
    const r = await this.db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
    return r.rows[0] ? rowToUser(r.rows[0] as any) : null;
  }

  async getUserByUsername(username: string): Promise<UserSummary | null> {
    const r = await this.db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    return r.rows[0] ? rowToUser(r.rows[0] as any) : null;
  }

  async getVault(username: string): Promise<VaultBlob | null> {
    const r = await this.db.execute({
      sql: 'SELECT vault_salt, vault_iv, vault_ct FROM users WHERE username = ?',
      args: [username],
    });
    const row = r.rows[0] as any;
    return row ? { salt: row.vault_salt, iv: row.vault_iv, ciphertext: row.vault_ct } : null;
  }

  async listUsersInRoom(roomId: string): Promise<UserSummary[]> {
    const r = await this.db.execute({
      sql: `SELECT u.* FROM users u
            JOIN room_members rm ON rm.user_id = u.id
            WHERE rm.room_id = ? ORDER BY u.created_at`,
      args: [roomId],
    });
    return r.rows.map((row) => rowToUser(row as any));
  }

  // --- rooms ---------------------------------------------------------------

  async createRoom(r: NewRoom): Promise<RoomSummary> {
    const id = newId();
    const now = Date.now();
    await this.db.batch(
      [
        {
          sql: 'INSERT INTO rooms (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [id, r.name, r.inviteCode, r.createdBy, now],
        },
        {
          sql: 'INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)',
          args: [id, r.createdBy, now],
        },
      ],
      'write',
    );
    return { id, name: r.name, inviteCode: r.inviteCode, memberCount: 1, createdBy: r.createdBy, createdAt: now };
  }

  async getRoom(id: string): Promise<RoomSummary | null> {
    const res = await this.db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [id] });
    const row = res.rows[0] as any;
    return row ? rowToRoom(row, await this.roomMemberCount(id)) : null;
  }

  async getRoomByCode(inviteCode: string): Promise<RoomSummary | null> {
    const res = await this.db.execute({ sql: 'SELECT * FROM rooms WHERE invite_code = ?', args: [inviteCode] });
    const row = res.rows[0] as any;
    return row ? rowToRoom(row, await this.roomMemberCount(row.id)) : null;
  }

  async listRoomsForUser(userId: string): Promise<RoomSummary[]> {
    const res = await this.db.execute({
      sql: `SELECT r.* FROM rooms r
            JOIN room_members rm ON rm.room_id = r.id
            WHERE rm.user_id = ? ORDER BY r.created_at`,
      args: [userId],
    });
    const out: RoomSummary[] = [];
    for (const row of res.rows) out.push(rowToRoom(row as any, await this.roomMemberCount((row as any).id)));
    return out;
  }

  async roomMemberCount(roomId: string): Promise<number> {
    const res = await this.db.execute({ sql: 'SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?', args: [roomId] });
    return Number((res.rows[0] as any)?.n ?? 0);
  }

  async userRoomCount(userId: string): Promise<number> {
    const res = await this.db.execute({ sql: 'SELECT COUNT(*) AS n FROM room_members WHERE user_id = ?', args: [userId] });
    return Number((res.rows[0] as any)?.n ?? 0);
  }

  async isRoomMember(roomId: string, userId: string): Promise<boolean> {
    const res = await this.db.execute({
      sql: 'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?',
      args: [roomId, userId],
    });
    return res.rows.length > 0;
  }

  async addRoomMember(roomId: string, userId: string): Promise<void> {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)',
      args: [roomId, userId, Date.now()],
    });
  }

  async setRoomInviteCode(roomId: string, inviteCode: string): Promise<void> {
    await this.db.execute({ sql: 'UPDATE rooms SET invite_code = ? WHERE id = ?', args: [inviteCode, roomId] });
  }

  async createConversation(c: NewConversation): Promise<ConversationSummary> {
    const id = newId();
    const now = Date.now();
    // One write batch: conversation and members commit together or not at all.
    await this.db.batch(
      [
        {
          sql: 'INSERT INTO conversations (id, room_id, kind, title_ciphertext, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id, c.roomId, c.kind, c.titleCiphertext, c.createdBy, now],
        },
        ...c.members.map((m) => ({
          sql: 'INSERT INTO members (conversation_id, user_id, wrapped_key, joined_at) VALUES (?, ?, ?, ?)',
          args: [id, m.userId, m.wrappedKey, now],
        })),
      ],
      'write',
    );
    return {
      id,
      roomId: c.roomId,
      kind: c.kind,
      titleCiphertext: c.titleCiphertext,
      memberIds: c.members.map((m) => m.userId),
      createdBy: c.createdBy,
      createdAt: now,
    };
  }

  async addMembers(conversationId: string, members: MemberKey[]): Promise<ConversationSummary | null> {
    const now = Date.now();
    // One write batch, for the same reason the sqlite backend uses one
    // transaction: the membership and the kind it implies commit together.
    await this.db.batch(
      [
        ...members.map((m) => ({
          sql: ADD_MEMBER_SQL,
          args: [conversationId, m.userId, m.wrappedKey, now],
        })),
        { sql: PROMOTE_TO_GROUP_SQL, args: [conversationId] },
      ],
      'write',
    );
    return this.assembleConversation(conversationId);
  }

  private async assembleConversation(id: string): Promise<ConversationSummary | null> {
    const conv = await this.db.execute({ sql: 'SELECT * FROM conversations WHERE id = ?', args: [id] });
    const row = conv.rows[0] as any;
    if (!row) return null;
    const members = await this.db.execute({
      sql: 'SELECT user_id FROM members WHERE conversation_id = ?',
      args: [id],
    });
    return {
      id: row.id,
      roomId: row.room_id,
      kind: row.kind,
      titleCiphertext: row.title_ciphertext,
      memberIds: members.rows.map((m) => m.user_id as string),
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
    };
  }

  async getConversation(id: string): Promise<ConversationSummary | null> {
    return this.assembleConversation(id);
  }

  async listConversationsForUser(userId: string, roomId: string): Promise<ConversationSummary[]> {
    const r = await this.db.execute({
      sql: `SELECT m.conversation_id FROM members m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE m.user_id = ? AND c.room_id = ?`,
      args: [userId, roomId],
    });
    const out: ConversationSummary[] = [];
    for (const row of r.rows) {
      const c = await this.assembleConversation(row.conversation_id as string);
      if (c) out.push(c);
    }
    return out;
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const r = await this.db.execute({
      sql: 'SELECT 1 FROM members WHERE conversation_id = ? AND user_id = ?',
      args: [conversationId, userId],
    });
    return r.rows.length > 0;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const r = await this.db.execute({
      sql: 'SELECT user_id FROM members WHERE conversation_id = ?',
      args: [conversationId],
    });
    return r.rows.map((row) => row.user_id as string);
  }

  async wrappedKeyFor(conversationId: string, userId: string): Promise<string | null> {
    const r = await this.db.execute({
      sql: 'SELECT wrapped_key FROM members WHERE conversation_id = ? AND user_id = ?',
      args: [conversationId, userId],
    });
    return r.rows[0] ? (r.rows[0].wrapped_key as string) : null;
  }

  async appendMessage(m: NewMessage): Promise<WireMessage> {
    const id = newId();
    const sentAt = Date.now();
    await this.db.execute({
      sql: 'INSERT INTO messages (id, conversation_id, sender_id, seq, iv, ciphertext, signature, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, m.conversationId, m.senderId, m.seq, m.iv, m.ciphertext, m.signature, sentAt],
    });
    return { id, ...m, sentAt, deliveredAt: null, readAt: null, editedAt: null, seenBy: 0 };
  }

  async editMessage(
    messageId: string,
    senderId: string,
    body: { iv: string; ciphertext: string; signature: string },
    at: number,
  ): Promise<WireMessage | null> {
    const res = await this.db.execute({
      sql: EDIT_MESSAGE_SQL,
      args: [body.iv, body.ciphertext, body.signature, at, messageId, senderId],
    });
    // No row changed means no such message, or not this author's.
    if (res.rowsAffected === 0) return null;
    const r = await this.db.execute({ sql: 'SELECT * FROM messages WHERE id = ?', args: [messageId] });
    const row = r.rows[0] as any;
    return row ? rowToMessage(row) : null;
  }

  async markDelivered(messageIds: string[], at: number): Promise<void> {
    if (messageIds.length === 0) return;
    await this.db.execute({ sql: markSql('delivered_at', messageIds.length), args: [at, ...messageIds] });
  }

  async markRead(messageIds: string[], at: number): Promise<void> {
    if (messageIds.length === 0) return;
    await this.db.execute({ sql: markSql('read_at', messageIds.length), args: [at, ...messageIds] });
  }

  async addReads(messageIds: string[], userId: string, at: number): Promise<Record<string, number>> {
    if (messageIds.length === 0) return {};
    await this.db.batch(
      messageIds.map((id) => ({ sql: ADD_READ_SQL, args: [id, userId, at] })),
      'write',
    );
    return this.seenCounts(messageIds);
  }

  /** Reader counts for these ids. Absent means nobody, so zero. */
  private async seenCounts(messageIds: string[]): Promise<Record<string, number>> {
    if (messageIds.length === 0) return {};
    const r = await this.db.execute({ sql: seenCountSql(messageIds.length), args: messageIds });
    const out: Record<string, number> = {};
    for (const row of r.rows as any[]) out[row.message_id] = Number(row.n);
    return out;
  }

  async messagesByIds(messageIds: string[]): Promise<WireMessage[]> {
    if (messageIds.length === 0) return [];
    const holes = Array(messageIds.length).fill('?').join(', ');
    const r = await this.db.execute({
      sql: `SELECT * FROM messages WHERE id IN (${holes})`,
      args: messageIds,
    });
    return r.rows.map((row) => rowToMessage(row as any));
  }

  async history(conversationId: string, before: string | undefined): Promise<WireMessage[]> {
    let beforeAt = Number.MAX_SAFE_INTEGER;
    if (before) {
      const b = await this.db.execute({
        sql: 'SELECT sent_at FROM messages WHERE id = ?',
        args: [before],
      });
      if (b.rows[0]) beforeAt = Number(b.rows[0].sent_at);
    }
    // Exclude anything already past retention, mirroring the local backend.
    const floor = Date.now() - RETENTION_MS;
    const r = await this.db.execute({
      sql: 'SELECT * FROM messages WHERE conversation_id = ? AND sent_at < ? AND sent_at >= ? ORDER BY sent_at DESC LIMIT ?',
      args: [conversationId, beforeAt, floor, HISTORY_PAGE],
    });
    const messages = r.rows.map((row) => rowToMessage(row as any));
    // One grouped query for the page, mirroring the local backend.
    const counts = await this.seenCounts(messages.map((m) => m.id));
    return messages.map((m) => ({ ...m, seenBy: counts[m.id] ?? 0 }));
  }

  async sweepExpired(cutoff: number): Promise<number> {
    const r = await this.db.execute({
      sql: 'DELETE FROM messages WHERE sent_at < ?',
      args: [cutoff],
    });
    // Who read a message is a fact about that message, so it goes with it.
    await this.db.execute(SWEEP_READS_SQL);
    return r.rowsAffected;
  }
}
