/**
 * What is actually inside a sealed message.
 *
 * A message used to be exactly its text, so anything *about* a message - what it
 * replies to, where it was forwarded from - would have had to travel beside the
 * ciphertext, where the server can read it. A reply edge is not harmless
 * metadata: it is the shape of a conversation, who answers whom and how fast.
 * So the extra parts go inside the envelope, and the server carries them without
 * knowing they exist.
 *
 * The encoding is a JSON object with a version, encoded as the plaintext the
 * message seals. Two rules keep it safe to change later:
 *
 *   - Anything that is not one of our objects is a plain-text message. Messages
 *     sent before this existed are bare strings, and they must keep working;
 *     within the 7-day window there are live ones.
 *   - Unknown fields are ignored and unknown versions fall back to the text,
 *     so a newer client can add parts without an older one dropping messages.
 *
 * A quoted reply carries a snippet of what it answers, not just its id. The id
 * alone would show nothing to anyone who does not have that message - it may
 * have expired, or they may have been added to the conversation afterwards - and
 * a reply to a message you cannot see is a reply to nothing. It costs a few
 * dozen bytes inside ciphertext the server cannot read anyway.
 */

/** How much of the quoted message to carry. Enough to recognise, not to archive. */
const QUOTE_MAX = 140;

export interface Quote {
  /** The message answered, so tapping the quote can jump to it when present. */
  id: string;
  /** Who wrote it, named at the time of the reply. */
  by: string;
  text: string;
}

export interface Body {
  text: string;
  quote?: Quote;
  /** Who wrote the message originally, when this is a forward. */
  forwardedFrom?: string;
}

interface Envelope {
  v: 1;
  t: string;
  r?: { id: string; by: string; text: string };
  f?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Encode a body as the plaintext to seal. Plain text stays plain text. */
export function encodeBody(body: Body): string {
  if (!body.quote && !body.forwardedFrom) return body.text;
  const envelope: Envelope = { v: 1, t: body.text };
  if (body.quote) {
    envelope.r = {
      id: body.quote.id,
      by: body.quote.by,
      text: body.quote.text.slice(0, QUOTE_MAX),
    };
  }
  if (body.forwardedFrom) envelope.f = body.forwardedFrom;
  return JSON.stringify(envelope);
}

/**
 * Decode decrypted plaintext. Never throws and never returns nothing: whatever
 * came out of the envelope, the worst case is that it is shown as its own text,
 * which is what every message was before this existed.
 */
export function decodeBody(plaintext: string): Body {
  // Cheap gate before parsing: our envelopes are objects, so anything not
  // starting with { is text, and most messages are text.
  if (!plaintext.startsWith('{')) return { text: plaintext };
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { text: plaintext };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: plaintext };
  const e = parsed as Record<string, unknown>;
  // A JSON object that is not ours - or is from a version this client does not
  // know - is shown as written rather than silently emptied.
  if (e.v !== 1 || typeof e.t !== 'string') return { text: plaintext };

  const body: Body = { text: e.t };
  const r = e.r;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const q = r as Record<string, unknown>;
    const id = str(q.id);
    if (id) {
      body.quote = {
        id,
        by: str(q.by) ?? 'Someone',
        text: (str(q.text) ?? '').slice(0, QUOTE_MAX),
      };
    }
  }
  const f = str(e.f);
  if (f) body.forwardedFrom = f;
  return body;
}

/** A snippet of a message, for quoting it in a reply. */
export function quoteOf(id: string, by: string, text: string): Quote {
  return { id, by, text: text.slice(0, QUOTE_MAX) };
}
