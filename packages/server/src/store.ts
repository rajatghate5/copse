/**
 * Storage, behind one interface with two implementations.
 *
 *   - SqliteStore  a local file via bun:sqlite. Used offline / hotspot mode.
 *   - TursoStore   hosted libSQL. Used on Render, whose free tier has no disk.
 *
 * Both speak the same SQL and store the same thing: ciphertext and public keys.
 * No column here ever holds readable message content - `ciphertext`,
 * `title_ciphertext` and `wrapped_key` are opaque blobs the server routes but
 * cannot open. That is what makes hosting on someone else's database (Turso)
 * acceptable rather than a compromise.
 *
 * The interface is async so the two drivers - bun:sqlite is synchronous, libsql
 * is not - present the same shape to the rest of the server.
 */

import type {
  ConversationKind,
  ConversationSummary,
  MemberKey,
  UserSummary,
  VaultBlob,
  WireMessage,
} from '@copse/protocol';

/** How many messages one history page returns. */
export const HISTORY_PAGE = 50;

/**
 * How long a message lives before it is swept. Defined in @copse/protocol so the
 * client and server share one number; re-exported here for the store code that
 * enforces it. Enforced by deletion, not just by hiding.
 */
export { RETENTION_MS } from '@copse/protocol';

/** The schema. Identical for both backends; libSQL is SQLite-compatible. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  enc_pub       TEXT NOT NULL,
  sig_pub       TEXT NOT NULL,
  vault_salt    TEXT NOT NULL,
  vault_iv      TEXT NOT NULL,
  vault_ct      TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  title_ciphertext  TEXT,
  created_by        TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  conversation_id  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  wrapped_key      TEXT NOT NULL,
  joined_at        INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  sender_id        TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  iv               TEXT NOT NULL,
  ciphertext       TEXT NOT NULL,
  signature        TEXT NOT NULL,
  sent_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_user ON members (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, sent_at);
`;

export interface NewUser {
  username: string;
  displayName: string;
  encPub: string;
  sigPub: string;
  vault: VaultBlob;
}

export interface NewConversation {
  kind: ConversationKind;
  titleCiphertext: string | null;
  createdBy: string;
  members: MemberKey[];
}

export interface NewMessage {
  conversationId: string;
  senderId: string;
  seq: number;
  iv: string;
  ciphertext: string;
  signature: string;
}

export interface Store {
  init(): Promise<void>;

  createUser(u: NewUser): Promise<UserSummary>;
  getUser(id: string): Promise<UserSummary | null>;
  getUserByUsername(username: string): Promise<UserSummary | null>;
  /** The sealed passphrase vault for a username, for unlocking on a new device. */
  getVault(username: string): Promise<VaultBlob | null>;
  listUsers(): Promise<UserSummary[]>;

  createConversation(c: NewConversation): Promise<ConversationSummary>;
  getConversation(id: string): Promise<ConversationSummary | null>;
  listConversationsForUser(userId: string): Promise<ConversationSummary[]>;

  isMember(conversationId: string, userId: string): Promise<boolean>;
  memberIds(conversationId: string): Promise<string[]>;
  /** The conversation key wrapped for one member, or null if not a member. */
  wrappedKeyFor(conversationId: string, userId: string): Promise<string | null>;

  appendMessage(m: NewMessage): Promise<WireMessage>;
  /** A page of history, newest-first, older than `before` (a message id) if set. */
  history(conversationId: string, before: string | undefined): Promise<WireMessage[]>;

  /** Delete every message sent before `cutoff` (epoch ms). Returns the count. */
  sweepExpired(cutoff: number): Promise<number>;
}

/** A short, URL-safe unique id. crypto.randomUUID is present in Bun and browsers. */
export function newId(): string {
  return crypto.randomUUID();
}

// --- row mappers, shared by both backends -----------------------------------

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  enc_pub: string;
  sig_pub: string;
}

export function rowToUser(r: UserRow): UserSummary {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    keys: { encPub: r.enc_pub, sigPub: r.sig_pub },
  };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  seq: number;
  iv: string;
  ciphertext: string;
  signature: string;
  sent_at: number;
}

export function rowToMessage(r: MessageRow): WireMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    seq: r.seq,
    iv: r.iv,
    ciphertext: r.ciphertext,
    signature: r.signature,
    sentAt: r.sent_at,
  };
}
