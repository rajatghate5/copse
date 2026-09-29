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

export class TursoStore implements Store {
  private db: Client;

  constructor(url: string, authToken?: string) {
    this.db = createClient({ url, authToken });
  }

  async init(): Promise<void> {
    // The schema is several statements; executeMultiple runs them as one script.
    await this.db.executeMultiple(SCHEMA);
  }

  async createUser(u: NewUser): Promise<UserSummary> {
    const id = newId();
    await this.db.execute({
      sql: 'INSERT INTO users (id, username, display_name, enc_pub, sig_pub, vault_salt, vault_iv, vault_ct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, u.username, u.displayName, u.encPub, u.sigPub, u.vault.salt, u.vault.iv, u.vault.ciphertext, Date.now()],
    });
    return {
      id,
      username: u.username,
      displayName: u.displayName,
      keys: { encPub: u.encPub, sigPub: u.sigPub },
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

  async listUsers(): Promise<UserSummary[]> {
    const r = await this.db.execute('SELECT * FROM users ORDER BY created_at');
    return r.rows.map((row) => rowToUser(row as any));
  }

  async createConversation(c: NewConversation): Promise<ConversationSummary> {
    const id = newId();
    const now = Date.now();
    // One write batch: conversation and members commit together or not at all.
    await this.db.batch(
      [
        {
          sql: 'INSERT INTO conversations (id, kind, title_ciphertext, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [id, c.kind, c.titleCiphertext, c.createdBy, now],
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
      kind: c.kind,
      titleCiphertext: c.titleCiphertext,
      memberIds: c.members.map((m) => m.userId),
      createdBy: c.createdBy,
      createdAt: now,
    };
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

  async listConversationsForUser(userId: string): Promise<ConversationSummary[]> {
    const r = await this.db.execute({
      sql: 'SELECT conversation_id FROM members WHERE user_id = ?',
      args: [userId],
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
    return { id, ...m, sentAt };
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
    return r.rows.map((row) => rowToMessage(row as any));
  }

  async sweepExpired(cutoff: number): Promise<number> {
    const r = await this.db.execute({
      sql: 'DELETE FROM messages WHERE sent_at < ?',
      args: [cutoff],
    });
    return r.rowsAffected;
  }
}
