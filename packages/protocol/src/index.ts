/**
 * The wire protocol, shared by server and client.
 *
 * Design rule, inherited deliberately from No Mercy: the client sends INTENT,
 * the server owns state, and everything inbound is untrusted. Here that rule has
 * a second edge - the server also never sees plaintext. Message bodies,
 * conversation titles and wrapped keys cross the wire and land in the database as
 * opaque base64. The server routes them; it cannot read them.
 *
 * All cryptographic material travels as base64 strings, not bytes, so a message
 * is plain JSON. The client converts to and from Uint8Array at the edges using
 * @copse/crypto.
 */

export const PROTOCOL_VERSION = 1;

// --- limits -----------------------------------------------------------------

/**
 * Messages are kept for one week, then deleted outright (not merely hidden).
 * Shared here so the server enforces it and the client can label how long a
 * message has left - one number, one source of truth.
 */
export const RETENTION_DAYS = 7;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const MAX_NAME_LENGTH = 32;
/** Ciphertext is bigger than plaintext; this caps a message near ~6KB of text. */
export const MAX_CIPHERTEXT_LENGTH = 8192;
/** A wrapped 32-byte key is tiny; this is generous headroom against abuse. */
export const MAX_WRAPPED_KEY_LENGTH = 1024;
export const MAX_MEMBERS = 16;
/** base64 of a 32-byte key is 44 chars; anything far off is malformed. */
export const KEY_B64_MAX = 128;

/**
 * Room caps. A room is a sealed-off space; a member may belong to a few of them,
 * and each holds a small circle. The admin (the bootstrap account) is exempt from
 * the per-user limit so they can run as many rooms as they like. One source of
 * truth, shared by server (enforcement) and client (greying out "create").
 */
export const ROOM_MAX_MEMBERS = 10;
export const MAX_ROOMS_PER_USER = 3;
export const MAX_ROOM_NAME_LENGTH = 40;
export const INVITE_CODE_MAX = 48;

/**
 * Strip ASCII control characters and DEL from anything a stranger typed.
 *
 * Display names are printed into server logs (a terminal) and into other
 * people's clients. An unescaped ESC inside a name would let anyone emit ANSI
 * sequences across someone else's screen, so this is a security boundary, not
 * cosmetics - taken wholesale from No Mercy for the same reason. Built with
 * `new RegExp` so this source file contains no literal control bytes.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.replace(CONTROL_CHARS, '').trim().slice(0, MAX_NAME_LENGTH) || 'someone';
}

/** A base64 string of plausible length, or null. Does not decode - shape only. */
export function cleanB64(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > max) return null;
  // Base64 alphabet only. Content is validated by decryption downstream; this is
  // the cheap gate that keeps junk out of the database.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? raw : null;
}

// --- shared shapes ----------------------------------------------------------

export type ConversationKind = 'direct' | 'group';

/** A user's public identity as it travels on the wire (base64). */
export interface PublicKeys {
  readonly encPub: string;
  readonly sigPub: string;
}

/** A member of a conversation, with the conversation key wrapped for them. */
export interface MemberKey {
  readonly userId: string;
  /** base64 of the WrappedKey (ephPub ‖ iv ‖ ciphertext), packed by the client. */
  readonly wrappedKey: string;
}

/** A user as others see them in a roster. Never carries private data. */
export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly keys: PublicKeys;
  /** The bootstrap account. Shown as an "admin" badge; may create unlimited rooms. */
  readonly isAdmin: boolean;
}

/**
 * A room as a member sees it: a sealed-off space with its own directory and
 * conversations. The invite code is only ever sent to members, so it is safe to
 * carry here - the server never hands a RoomSummary to a non-member.
 */
export interface RoomSummary {
  readonly id: string;
  readonly name: string;
  readonly inviteCode: string;
  readonly memberCount: number;
  readonly createdBy: string;
  readonly createdAt: number;
}

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 24;

/**
 * Normalise a username: lowercase, and only unambiguous URL-safe characters, so
 * a handle reads the same however it was typed and is safe in a path. Returns
 * null if nothing usable remains - the caller rejects the registration.
 */
export function cleanUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return s.length >= MIN_USERNAME_LENGTH && s.length <= MAX_USERNAME_LENGTH ? s : null;
}

/** A room name a stranger typed: control chars stripped, bounded, never empty. */
export function cleanRoomName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.replace(CONTROL_CHARS, '').trim().slice(0, MAX_ROOM_NAME_LENGTH) || 'room';
}

/**
 * Normalise an invite code to the same URL-safe alphabet the server mints
 * (lowercase letters, digits, hyphens). Returns null if nothing plausible
 * remains, so the caller rejects it before any lookup. Shape only - the code is
 * validated by looking it up, not by decoding.
 */
export function cleanInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return s.length >= 4 && s.length <= INVITE_CODE_MAX ? s : null;
}

/** A conversation as the client lists it. Title is ciphertext until decrypted. */
export interface ConversationSummary {
  readonly id: string;
  /** The room this conversation belongs to. Conversations never cross rooms. */
  readonly roomId: string;
  readonly kind: ConversationKind;
  /** base64 ciphertext of the title, or null for a direct chat (named by peer). */
  readonly titleCiphertext: string | null;
  readonly memberIds: string[];
  readonly createdBy: string;
  readonly createdAt: number;
}

/** One message on the wire and in storage. The body is opaque to the server. */
export interface WireMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly seq: number;
  readonly iv: string;
  readonly ciphertext: string;
  readonly signature: string;
  /** Server-stamped receipt time. Clients are not trusted with the clock. */
  readonly sentAt: number;
  /**
   * When the author last replaced the body, or null. The server stamps it and
   * swaps the ciphertext; it still cannot read either version.
   */
  readonly editedAt: number | null;
  /** When another member first received it, or null. Server-stamped. */
  readonly deliveredAt: number | null;
  /** When another member first read it, or null. Server-stamped. */
  readonly readAt: number | null;
}

/** Presence: whether a peer is mid-message. Never affects stored state. */
export interface TypingState {
  readonly userId: string;
  readonly conversationId: string;
  readonly typing: boolean;
}

// --- client -> server -------------------------------------------------------

export type ClientMessage =
  /** Open a conversation. Members and their wrapped keys are decided client-side. */
  | {
      t: 'createConversation';
      kind: ConversationKind;
      titleCiphertext: string | null;
      members: MemberKey[];
    }
  /** Send one sealed message into a conversation the sender belongs to. */
  | {
      t: 'send';
      conversationId: string;
      seq: number;
      iv: string;
      ciphertext: string;
      signature: string;
    }
  /**
   * Add people to a conversation you are already in. Their wrapped keys are
   * made client-side, which is the only way they can be - the server has never
   * held the conversation key and cannot wrap it for anyone.
   *
   * There is one key per conversation and no re-keying, so whoever is added can
   * read the whole thread, including what was said before they arrived. That is
   * a property of the design (no forward secrecy, a shared key all members
   * hold), so the client states it rather than implying otherwise.
   */
  | { t: 'addMembers'; conversationId: string; members: MemberKey[] }
  /**
   * Replace the body of one of your own messages. The seq is not resent: it is
   * part of what the original signature covers, so an edit re-signs the same
   * (conversation, sender, seq) and the server keeps the row it already has.
   * The server checks only that the message is yours; it cannot compare the two
   * versions, because it can read neither.
   */
  | {
      t: 'edit';
      conversationId: string;
      messageId: string;
      iv: string;
      ciphertext: string;
      signature: string;
    }
  /** Ask for a page of history, older than `before` (a message id) if given. */
  | { t: 'history'; conversationId: string; before?: string }
  /** Fire-and-forget typing indicator. Never stored. */
  | { t: 'typing'; conversationId: string; typing: boolean }
  /**
   * Messages this client has now displayed to its user. Ids, not a watermark:
   * `seq` is per-sender, so "up to N" has no single meaning in a group. The
   * server ignores any id that is not in the conversation or was sent by the
   * reader themselves.
   */
  | { t: 'read'; conversationId: string; messageIds: string[] };

// --- server -> client -------------------------------------------------------

export type ServerMessage =
  /** First frame on every socket, before auth completes. Carries the version. */
  | { t: 'hello'; version: number }
  /**
   * Sent after the socket authenticates. The socket is scoped to one room, so
   * `users` and `conversations` are that room's only; `room` is the current room
   * and `rooms` is every room the user belongs to (for the switcher).
   */
  | {
      t: 'ready';
      you: UserSummary;
      room: RoomSummary;
      rooms: RoomSummary[];
      users: UserSummary[];
      conversations: ConversationSummary[];
    }
  /** A user joined the current room's directory, so clients can wrap keys to them. */
  | { t: 'user'; user: UserSummary }
  | { t: 'conversation'; conversation: ConversationSummary }
  /** A wrapped conversation key addressed to the receiving client. */
  | { t: 'key'; conversationId: string; wrappedKey: string }
  | { t: 'message'; message: WireMessage }
  /** A message whose author replaced its body. Same id, new ciphertext. */
  | { t: 'edited'; message: WireMessage }
  /** A page of history, oldest-first, in response to a `history` request. */
  | { t: 'history'; conversationId: string; messages: WireMessage[]; done: boolean }
  | { t: 'typing'; state: TypingState }
  /**
   * Who in the current room has a live socket on it, as a whole list rather than
   * a delta - it is at most ROOM_MAX_MEMBERS long, and a full list cannot drift
   * out of sync the way add/remove pairs can. Derived from the socket registry
   * on the server; a client never asserts its own presence.
   */
  | { t: 'presence'; userIds: string[] }
  /**
   * Someone other than the sender received or read these messages. Sent to the
   * sender only, and it names no reader: one stamp per message, meaning
   * "someone", which is all the ticks claim.
   */
  | { t: 'receipt'; messageIds: string[]; kind: 'delivered' | 'read'; at: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'unauthenticated'
  | 'bad_version'
  | 'bad_message'
  | 'not_a_member'
  | 'not_a_room_member'
  | 'no_such_conversation'
  | 'not_your_message'
  | 'rate_limited'
  | 'too_large';

/** Parse an untrusted wire payload. Returns null instead of throwing. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const t = (data as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  // Structural gate only. The server validates each variant's fields against the
  // socket's authenticated identity and the conversation's membership.
  return data as ClientMessage;
}
