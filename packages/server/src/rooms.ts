/**
 * Invite-code minting. A code is what someone shares to pull a person into a
 * room, so it should be easy to read aloud and type: two short words and a few
 * hex digits, e.g. `amber-pine-7f3a`. It is URL-safe (lowercase, hyphens) so it
 * drops straight into a `/?join=CODE` link, and it is rotatable - regenerating a
 * room's code closes a leaked link without losing the room.
 *
 * The words carry no meaning; the hex suffix is the entropy that keeps codes from
 * colliding. Generation is random, and the caller checks the store for the rare
 * clash and retries.
 */

import { randomBytes } from '@copse/crypto';

const WORDS = [
  'amber', 'pine', 'cedar', 'fern', 'moss', 'slate', 'ember', 'birch',
  'elm', 'sage', 'clay', 'reed', 'dusk', 'dawn', 'holt', 'grove',
  'vale', 'brook', 'heath', 'thorn', 'maple', 'aspen', 'willow', 'ash',
];

function pick(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)]!;
}

function hex(bytes: number): string {
  return Array.from(randomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** One candidate code. Not guaranteed unique - the caller checks and retries. */
export function mintInviteCode(): string {
  return `${pick()}-${pick()}-${hex(2)}`;
}

/**
 * A code the store confirms is free. `taken` is the store's lookup; after a few
 * tries (collisions are vanishingly unlikely with 16 bits plus word choice) it
 * falls back to a longer random code that effectively cannot clash.
 */
export async function uniqueInviteCode(taken: (code: string) => Promise<boolean>): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = mintInviteCode();
    if (!(await taken(code))) return code;
  }
  return `room-${hex(8)}`;
}
