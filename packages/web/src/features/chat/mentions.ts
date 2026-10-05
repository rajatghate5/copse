/**
 * What counts as an @mention, in one place, because three parts of the app have
 * to agree about it: the composer offering completions, the bubble highlighting
 * them, and the notification deciding whether to say someone mentioned you. If
 * those three disagreed you would get a highlight with no notification, or
 * worse, the other way round.
 *
 * A handle is matched with the same alphabet `cleanUsername` normalises to in
 * @copse/protocol, so anything the composer can complete is something that can
 * really exist. The @ must start the text or follow a character that is not part
 * of a handle, so "mail@example" does not read as a mention of "example".
 *
 * Nothing here leaves the device. A mention is plain text inside a message that
 * is sealed like any other, so the server cannot see who was mentioned - which
 * also means it cannot notify them. Mentions are found by the recipients' own
 * clients, on the text they have decrypted.
 */

import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from '@copse/protocol';

const HANDLE = `[a-z0-9_-]{${MIN_USERNAME_LENGTH},${MAX_USERNAME_LENGTH}}`;

/** Global, for splitting a whole message. Rebuilt per call: /g keeps state. */
function mentionRe(): RegExp {
  return new RegExp(`(^|[^a-z0-9_-])@(${HANDLE})`, 'gi');
}

export interface TextPart {
  text: string;
  /** The handle, when this part is a mention. */
  handle?: string;
}

/**
 * Split a message into plain runs and mentions, so a bubble can style the
 * mentions without putting any of the message through innerHTML.
 */
export function splitMentions(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = mentionRe();
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const lead = m[1] ?? '';
    const handle = (m[2] ?? '').toLowerCase();
    const at = m.index + lead.length;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: `@${m[2]}`, handle });
    last = at + 1 + (m[2]?.length ?? 0);
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Whether this message mentions one particular handle. */
export function mentions(text: string, handle: string): boolean {
  const want = handle.toLowerCase();
  return splitMentions(text).some((p) => p.handle === want);
}

/**
 * The handle fragment being typed immediately before the caret, if any - the
 * trigger for the completion list. Null as soon as the caret moves past a
 * space, so the list does not hang around over the rest of the sentence.
 */
export function pendingHandle(text: string, caret: number): { query: string; from: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const before = at === 0 ? '' : upto[at - 1]!;
  if (before && /[a-z0-9_-]/i.test(before)) return null;
  const query = upto.slice(at + 1);
  if (!/^[a-z0-9_-]*$/i.test(query)) return null;
  if (query.length > MAX_USERNAME_LENGTH) return null;
  return { query: query.toLowerCase(), from: at };
}
