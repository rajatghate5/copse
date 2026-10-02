/**
 * The left half of the auth screens: a message being typed, then sealed.
 *
 * Ten chat bubbles sit in the upper four fifths of the panel. Each shows a
 * typing indicator, then hands over to the same rectangle filled with base64 —
 * the shape of the thing stays, the readable part does not. That is the whole
 * claim of the product in one loop, and it is the only animation in the app's
 * auth chrome.
 *
 * Two details that matter, both learned by getting them wrong first:
 * the stagger is exactly `DURATION / COUNT`, so the two faces hand over with no
 * gap where neither is visible and all but one bubble is always on screen; and
 * the copy below sits under a scrim that reaches only as high as the copy does,
 * so it keeps its contrast without dimming the art above it.
 *
 * The base64 is decorative and random — it is not derived from any real message,
 * key or account. Built once at module load so re-renders never reshuffle it.
 */

import { Brand } from '@/components/common.tsx';

const COUNT = 10;
/** One cycle, seconds. Long enough that a glance never catches the same frame. */
const DURATION = 14;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789+/';

/**
 * A fixed sequence, so the panel looks the same on every device and in every
 * build. `Math.random` would do visually, but then two tabs disagree and a
 * screenshot diff is never stable.
 */
function deterministic(seed: number) {
  let s = seed;
  return () => {
    // Park–Miller, enough for picking characters and sizes.
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

interface Bubble {
  top: string;
  left: string;
  w: number;
  h: number;
  tint: string;
  cipher: string;
  delay: number;
}

const TINTS = ['#3f8560', '#4c9a74', '#58a37f', '#2f6b4f', '#b8781f'];

// Spread across the band, two to a row, so neither edge of the panel is empty.
const SPOTS = [
  ['6%', '4%'], ['7%', '48%'], ['18%', '24%'], ['19%', '62%'], ['30%', '2%'],
  ['31%', '44%'], ['43%', '20%'], ['44%', '58%'], ['55%', '6%'], ['56%', '46%'],
] as const;

const BUBBLES: Bubble[] = (() => {
  const rnd = deterministic(20261002);
  return SPOTS.map(([top, left], i) => {
    const w = [200, 220, 242][Math.floor(rnd() * 3)]!;
    const h = rnd() < 0.5 ? 60 : 66;
    const chars = 92 + Math.floor(rnd() * 41);
    let cipher = '';
    for (let c = 0; c < chars; c++) cipher += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    return {
      top,
      left,
      w,
      h,
      tint: TINTS[i % TINTS.length]!,
      cipher,
      // Exactly one slot apart: no moment with two faces mid-fade on the same bubble.
      delay: -(i * DURATION) / COUNT,
      };
  });
})();

export function ArtPanel() {
  return (
    <aside className="pane-art">
      <div className="lane" aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <div key={i} className="turn" style={{ top: b.top, left: b.left, width: b.w, height: b.h }}>
            <div
              className="typing"
              style={{ '--c': b.tint, animationDuration: `${DURATION}s`, animationDelay: `${b.delay}s` } as React.CSSProperties}
            >
              <i />
              <i />
              <i />
            </div>
            <div
              className="sealed"
              style={{ animationDuration: `${DURATION}s`, animationDelay: `${b.delay}s` }}
            >
              {b.cipher}
            </div>
          </div>
        ))}
      </div>
      <div className="art-scrim" aria-hidden="true" />
      <div className="art-brand"><Brand /></div>
      <div className="art-copy">
        <h2>Only the people you trust. No one else.</h2>
        <p>End-to-end encrypted · signed per message · deleted after 7 days</p>
      </div>
    </aside>
  );
}
