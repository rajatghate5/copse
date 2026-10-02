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
  RoomSummary,
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
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  invite_code   TEXT NOT NULL UNIQUE,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL,
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
  sent_at          INTEGER NOT NULL,
  -- First time any OTHER member received / read this message. Null until then.
  -- One stamp, not one per member: the UI says "someone", and saying more would
  -- mean storing who read what, which is metadata this server does not need.
  delivered_at     INTEGER,
  read_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_room ON conversations (room_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, sent_at);
`;

/**
 * Additive column migrations for databases created before rooms existed.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a DB from an
 * earlier version keeps its old `users`/`conversations` shape. Each statement is
 * run and its "duplicate column" error ignored, so this is safe to run every
 * startup and on a brand-new database alike. NOT NULL needs a constant default;
 * rows predating rooms get `room_id = ''` and simply belong to no room (and
 * expire within the retention window anyway).
 */
export const MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE conversations ADD COLUMN room_id TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE messages ADD COLUMN delivered_at INTEGER',
  'ALTER TABLE messages ADD COLUMN read_at INTEGER',
];

export interface NewUser {
  username: string;
  displayName: string;
  encPub: string;
  sigPub: string;
  vault: VaultBlob;
  /** The bootstrap account is admin; everyone else is a plain member. */
  isAdmin?: boolean;
}

export interface NewRoom {
  name: string;
  inviteCode: string;
  createdBy: string;
}

export interface NewConversation {
  roomId: string;
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
  /** Everyone in a room - the directory a member may wrap keys to. */
  listUsersInRoom(roomId: string): Promise<UserSummary[]>;

  // --- rooms ---------------------------------------------------------------
  createRoom(r: NewRoom): Promise<RoomSummary>;
  getRoom(id: string): Promise<RoomSummary | null>;
  getRoomByCode(inviteCode: string): Promise<RoomSummary | null>;
  /** Every room the user belongs to, for the room switcher. */
  listRoomsForUser(userId: string): Promise<RoomSummary[]>;
  /** How many members a room has, to enforce the per-room cap. */
  roomMemberCount(roomId: string): Promise<number>;
  /** How many rooms a user belongs to, to enforce the per-user cap. */
  userRoomCount(userId: string): Promise<number>;
  isRoomMember(roomId: string, userId: string): Promise<boolean>;
  addRoomMember(roomId: string, userId: string): Promise<void>;
  /** Replace a room's invite code (rotation after a leak). */
  setRoomInviteCode(roomId: string, inviteCode: string): Promise<void>;

  createConversation(c: NewConversation): Promise<ConversationSummary>;
  getConversation(id: string): Promise<ConversationSummary | null>;
  /** The user's conversations within one room; conversations never cross rooms. */
  listConversationsForUser(userId: string, roomId: string): Promise<ConversationSummary[]>;

  /**
   * Add members to an existing conversation and return it as it now stands, or
   * null if there is no such conversation. Adding someone already in it is a
   * no-op: their original wrapped key and join time stand, so a double tap
   * cannot re-key anyone or move when they joined.
   */
  addMembers(conversationId: string, members: MemberKey[]): Promise<ConversationSummary | null>;

  isMember(conversationId: string, userId: string): Promise<boolean>;
  memberIds(conversationId: string): Promise<string[]>;
  /** The conversation key wrapped for one member, or null if not a member. */
  wrappedKeyFor(conversationId: string, userId: string): Promise<string | null>;

  appendMessage(m: NewMessage): Promise<WireMessage>;
  /**
   * Stamp the first delivery / read of these messages. Both are first-wins:
   * a later call never moves the time, so a reconnecting client replaying its
   * receipts cannot rewrite history.
   */
  markDelivered(messageIds: string[], at: number): Promise<void>;
  markRead(messageIds: string[], at: number): Promise<void>;
  /** Look up messages by id, for validating a batch of receipts. */
  messagesByIds(messageIds: string[]): Promise<WireMessage[]>;
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
  is_admin: number | boolean;
}

export function rowToUser(r: UserRow): UserSummary {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    keys: { encPub: r.enc_pub, sigPub: r.sig_pub },
    isAdmin: Boolean(Number(r.is_admin)),
  };
}

interface RoomRow {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: number;
}

export function rowToRoom(r: RoomRow, memberCount: number): RoomSummary {
  return {
    id: r.id,
    name: r.name,
    inviteCode: r.invite_code,
    memberCount,
    createdBy: r.created_by,
    createdAt: Number(r.created_at),
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
  delivered_at: number | null;
  read_at: number | null;
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
    // A row written before these columns existed reads as undefined, not null.
    deliveredAt: r.delivered_at ?? null,
    readAt: r.read_at ?? null,
  };
}

/** `OR IGNORE` is what makes re-adding an existing member a no-op. */
export const ADD_MEMBER_SQL =
  'INSERT OR IGNORE INTO members (conversation_id, user_id, wrapped_key, joined_at) VALUES (?, ?, ?, ?)';

/**
 * A conversation with more than two people in it is a group, whatever it was
 * created as - so growing a direct chat promotes it rather than leaving a row
 * that claims to be a pair. Counted in SQL, in the same transaction as the
 * insert, so it cannot disagree with the membership it is derived from.
 */
export const PROMOTE_TO_GROUP_SQL =
  "UPDATE conversations SET kind = 'group' WHERE id = ?" +
  ' AND (SELECT COUNT(*) FROM members WHERE conversation_id = conversations.id) > 2';

/**
 * `SET x = COALESCE(x, ?)` is what makes both marks first-wins, and the IN list
 * is built from placeholders so ids never reach the SQL as text.
 */
export function markSql(column: 'delivered_at' | 'read_at', count: number): string {
  return `UPDATE messages SET ${column} = COALESCE(${column}, ?) WHERE id IN (${Array(count).fill('?').join(', ')})`;
}
