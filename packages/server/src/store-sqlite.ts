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
  UserSummary,
  VaultBlob,
  WireMessage,
} from '@copse/protocol';
import {
  HISTORY_PAGE,
  RETENTION_MS,
  SCHEMA,
  newId,
  rowToMessage,
  rowToUser,
  type NewConversation,
  type NewMessage,
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
    this.db.exec(SCHEMA);
  }

  async createUser(u: NewUser): Promise<UserSummary> {
    const id = newId();
    this.db
      .query(
        'INSERT INTO users (id, username, display_name, enc_pub, sig_pub, vault_salt, vault_iv, vault_ct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, u.username, u.displayName, u.encPub, u.sigPub, u.vault.salt, u.vault.iv, u.vault.ciphertext, Date.now());
    return {
      id,
      username: u.username,
      displayName: u.displayName,
      keys: { encPub: u.encPub, sigPub: u.sigPub },
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

  async listUsers(): Promise<UserSummary[]> {
    const rows = this.db.query('SELECT * FROM users ORDER BY created_at').all() as any[];
    return rows.map(rowToUser);
  }

  async createConversation(c: NewConversation): Promise<ConversationSummary> {
    const id = newId();
    const now = Date.now();
    const insertConv = this.db.query(
      'INSERT INTO conversations (id, kind, title_ciphertext, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const insertMember = this.db.query(
      'INSERT INTO members (conversation_id, user_id, wrapped_key, joined_at) VALUES (?, ?, ?, ?)',
    );
    // One transaction: a conversation with no members, or members with no
    // conversation, is never observable.
    this.db.transaction(() => {
      insertConv.run(id, c.kind, c.titleCiphertext, c.createdBy, now);
      for (const m of c.members) insertMember.run(id, m.userId, m.wrappedKey, now);
    })();
    return {
      id,
      kind: c.kind,
      titleCiphertext: c.titleCiphertext,
      memberIds: c.members.map((m) => m.userId),
      createdBy: c.createdBy,
      createdAt: now,
    };
  }

  private async assembleConversation(id: string): Promise<ConversationSummary | null> {
    const conv = this.db.query('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!conv) return null;
    const memberIds = (
      this.db.query('SELECT user_id FROM members WHERE conversation_id = ?').all(id) as any[]
    ).map((r) => r.user_id as string);
    return {
      id: conv.id,
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

  async listConversationsForUser(userId: string): Promise<ConversationSummary[]> {
    const ids = (
      this.db.query('SELECT conversation_id FROM members WHERE user_id = ?').all(userId) as any[]
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
    return { id, ...m, sentAt };
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
