/**
 * Local storage via bun:sqlite - a single file on disk. This is the backend for
 * offline / hotspot mode, where there is no internet to reach Turso.
 *
 * bun:sqlite is synchronous; the Store interface is async. We wrap the sync
 * calls, which is honest: the work really is instant, there is just no I/O wait
 * to await. Foreign-key-style integrity is enforced in code, not by the schema,
 * to keep the schema identical to the libSQL backend.
 */

import { Database } from 'bun:sqlite';
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
  type NewConversation,
  type NewMessage,
  type NewRoom,
  type NewUser,
  type Store,
} from './store.ts';

export class SqliteStore implements Store {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  async init(): Promise<void> {
    // Migrate first: add columns a pre-rooms database lacks, so the schema's
    // room_id index can be created. On a fresh database these ALTERs hit a
    // missing table and are ignored; SCHEMA then creates everything correctly.
    for (const sql of MIGRATIONS) {
      try { this.db.exec(sql); } catch { /* table absent (fresh) or column present */ }
    }
    this.db.exec(SCHEMA);
  }

  async createUser(u: NewUser): Promise<UserSummary> {
    const id = newId();
    const isAdmin = u.isAdmin ? 1 : 0;
    this.db
      .query(
        'INSERT INTO users (id, username, display_name, enc_pub, sig_pub, vault_salt, vault_iv, vault_ct, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, u.username, u.displayName, u.encPub, u.sigPub, u.vault.salt, u.vault.iv, u.vault.ciphertext, isAdmin, Date.now());
    return {
      id,
      username: u.username,
      displayName: u.displayName,
      keys: { encPub: u.encPub, sigPub: u.sigPub },
      isAdmin: Boolean(isAdmin),
    };
  }

  async getUser(id: string): Promise<UserSummary | null> {
    const row = this.db.query('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? rowToUser(row) : null;
  }

  async getUserByUsername(username: string): Promise<UserSummary | null> {
    const row = this.db.query('SELECT * FROM users WHERE username = ?').get(username) as any;
    return row ? rowToUser(row) : null;
  }

  async getVault(username: string): Promise<VaultBlob | null> {
    const row = this.db
      .query('SELECT vault_salt, vault_iv, vault_ct FROM users WHERE username = ?')
      .get(username) as any;
    return row ? { salt: row.vault_salt, iv: row.vault_iv, ciphertext: row.vault_ct } : null;
  }

  async listUsersInRoom(roomId: string): Promise<UserSummary[]> {
    const rows = this.db
      .query(
        `SELECT u.* FROM users u
         JOIN room_members rm ON rm.user_id = u.id
         WHERE rm.room_id = ? ORDER BY u.created_at`,
      )
      .all(roomId) as any[];
    return rows.map(rowToUser);
  }

  // --- rooms ---------------------------------------------------------------

  async createRoom(r: NewRoom): Promise<RoomSummary> {
    const id = newId();
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .query('INSERT INTO rooms (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, r.name, r.inviteCode, r.createdBy, now);
      this.db
        .query('INSERT INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(id, r.createdBy, now);
    })();
    return { id, name: r.name, inviteCode: r.inviteCode, memberCount: 1, createdBy: r.createdBy, createdAt: now };
  }

  async getRoom(id: string): Promise<RoomSummary | null> {
    const row = this.db.query('SELECT * FROM rooms WHERE id = ?').get(id) as any;
    return row ? rowToRoom(row, await this.roomMemberCount(id)) : null;
  }

  async getRoomByCode(inviteCode: string): Promise<RoomSummary | null> {
    const row = this.db.query('SELECT * FROM rooms WHERE invite_code = ?').get(inviteCode) as any;
    return row ? rowToRoom(row, await this.roomMemberCount(row.id)) : null;
  }

  async listRoomsForUser(userId: string): Promise<RoomSummary[]> {
    const rows = this.db
      .query(
        `SELECT r.* FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id
         WHERE rm.user_id = ? ORDER BY r.created_at`,
      )
      .all(userId) as any[];
    const out: RoomSummary[] = [];
    for (const row of rows) out.push(rowToRoom(row, await this.roomMemberCount(row.id)));
    return out;
  }

  async roomMemberCount(roomId: string): Promise<number> {
    const row = this.db
      .query('SELECT COUNT(*) AS n FROM room_members WHERE room_id = ?')
      .get(roomId) as any;
    return Number(row?.n ?? 0);
  }

  async userRoomCount(userId: string): Promise<number> {
    const row = this.db
      .query('SELECT COUNT(*) AS n FROM room_members WHERE user_id = ?')
      .get(userId) as any;
    return Number(row?.n ?? 0);
  }

  async isRoomMember(roomId: string, userId: string): Promise<boolean> {
    const row = this.db
      .query('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(roomId, userId);
    return row !== null;
  }

  async addRoomMember(roomId: string, userId: string): Promise<void> {
    this.db
      .query('INSERT OR IGNORE INTO room_members (room_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(roomId, userId, Date.now());
  }

  async setRoomInviteCode(roomId: string, inviteCode: string): Promise<void> {
    this.db.query('UPDATE rooms SET invite_code = ? WHERE id = ?').run(inviteCode, roomId);
  }

  async createConversation(c: NewConversation): Promise<ConversationSummary> {
    const id = newId();
    const now = Date.now();
    const insertConv = this.db.query(
      'INSERT INTO conversations (id, room_id, kind, title_ciphertext, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertMember = this.db.query(
      'INSERT INTO members (conversation_id, user_id, wrapped_key, joined_at) VALUES (?, ?, ?, ?)',
    );
    // One transaction: a conversation with no members, or members with no
    // conversation, is never observable.
    this.db.transaction(() => {
      insertConv.run(id, c.roomId, c.kind, c.titleCiphertext, c.createdBy, now);
      for (const m of c.members) insertMember.run(id, m.userId, m.wrappedKey, now);
    })();
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
    const insert = this.db.query(ADD_MEMBER_SQL);
    const promote = this.db.query(PROMOTE_TO_GROUP_SQL);
    // One transaction: nobody can observe the new membership without the
    // promotion that follows from it.
    this.db.transaction(() => {
      for (const m of members) insert.run(conversationId, m.userId, m.wrappedKey, now);
      promote.run(conversationId);
    })();
    return this.assembleConversation(conversationId);
  }

  private async assembleConversation(id: string): Promise<ConversationSummary | null> {
    const conv = this.db.query('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!conv) return null;
    const memberIds = (
      this.db.query('SELECT user_id FROM members WHERE conversation_id = ?').all(id) as any[]
    ).map((r) => r.user_id as string);
    return {
      id: conv.id,
      roomId: conv.room_id,
      kind: conv.kind,
      titleCiphertext: conv.title_ciphertext,
      memberIds,
      createdBy: conv.created_by,
      createdAt: conv.created_at,
    };
  }

  async getConversation(id: string): Promise<ConversationSummary | null> {
    return this.assembleConversation(id);
  }

  async listConversationsForUser(userId: string, roomId: string): Promise<ConversationSummary[]> {
    const ids = (
      this.db
        .query(
          `SELECT m.conversation_id FROM members m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.user_id = ? AND c.room_id = ?`,
        )
        .all(userId, roomId) as any[]
    ).map((r) => r.conversation_id as string);
    const out: ConversationSummary[] = [];
    for (const id of ids) {
      const c = await this.assembleConversation(id);
      if (c) out.push(c);
    }
    return out;
  }

  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const row = this.db
      .query('SELECT 1 FROM members WHERE conversation_id = ? AND user_id = ?')
      .get(conversationId, userId);
    return row !== null;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    return (
      this.db.query('SELECT user_id FROM members WHERE conversation_id = ?').all(conversationId) as any[]
    ).map((r) => r.user_id as string);
  }

  async wrappedKeyFor(conversationId: string, userId: string): Promise<string | null> {
    const row = this.db
      .query('SELECT wrapped_key FROM members WHERE conversation_id = ? AND user_id = ?')
      .get(conversationId, userId) as any;
    return row ? (row.wrapped_key as string) : null;
  }

  async appendMessage(m: NewMessage): Promise<WireMessage> {
    const id = newId();
    const sentAt = Date.now();
    this.db
      .query(
        'INSERT INTO messages (id, conversation_id, sender_id, seq, iv, ciphertext, signature, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, m.conversationId, m.senderId, m.seq, m.iv, m.ciphertext, m.signature, sentAt);
    return { id, ...m, sentAt, deliveredAt: null, readAt: null };
  }

  async markDelivered(messageIds: string[], at: number): Promise<void> {
    if (messageIds.length === 0) return;
    this.db.query(markSql('delivered_at', messageIds.length)).run(at, ...messageIds);
  }

  async markRead(messageIds: string[], at: number): Promise<void> {
    if (messageIds.length === 0) return;
    this.db.query(markSql('read_at', messageIds.length)).run(at, ...messageIds);
  }

  async messagesByIds(messageIds: string[]): Promise<WireMessage[]> {
    if (messageIds.length === 0) return [];
    const holes = Array(messageIds.length).fill('?').join(', ');
    const rows = this.db.query(`SELECT * FROM messages WHERE id IN (${holes})`).all(...messageIds) as any[];
    return rows.map(rowToMessage);
  }

  async history(conversationId: string, before: string | undefined): Promise<WireMessage[]> {
    let beforeAt = Number.MAX_SAFE_INTEGER;
    if (before) {
      const row = this.db.query('SELECT sent_at FROM messages WHERE id = ?').get(before) as any;
      if (row) beforeAt = row.sent_at;
    }
    // Exclude anything already past retention, so a page never shows a message a
    // sweep is about to remove even in the window between sweeps.
    const floor = Date.now() - RETENTION_MS;
    const rows = this.db
      .query(
        'SELECT * FROM messages WHERE conversation_id = ? AND sent_at < ? AND sent_at >= ? ORDER BY sent_at DESC LIMIT ?',
      )
      .all(conversationId, beforeAt, floor, HISTORY_PAGE) as any[];
    return rows.map(rowToMessage);
  }

  async sweepExpired(cutoff: number): Promise<number> {
    const res = this.db.query('DELETE FROM messages WHERE sent_at < ?').run(cutoff);
    return res.changes;
  }
}
