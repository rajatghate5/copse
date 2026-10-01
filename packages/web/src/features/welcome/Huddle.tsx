/**
 * The welcome backdrop: a copse of chat. Message bubbles scattered in the space
 * around the sign-in card, each drifting gently on its own rhythm — the name (a
 * copse: a small gathering) and the product (chat) in one idea. Pure CSS/DOM, no
 * WebGL. Positions are viewport-relative and kept out of the card's centre column
 * so the bubbles stay visible; motion pauses under prefers-reduced-motion (handled
 * in the stylesheet).
 */

import type { CSSProperties } from 'react';

interface Bubble {
  left: string;
  top: string;
  w: number;
  h: number;
  color: string;
  right?: boolean;
  dots?: boolean;
  /** seconds for one float cycle, and how far (px) it drifts */
  dur: number;
  rise: number;
}

// Hand-placed around the card, favouring the empty gutters and the band above and
// below it, so nothing hides behind the sign-in form at any width.
const BUBBLES: Bubble[] = [
  { left: '12%', top: '16%', w: 92, h: 38, color: '#dcebe0', dur: 6, rise: 14 },
  { left: '78%', top: '12%', w: 66, h: 32, color: 'var(--accent)', right: true, dur: 7.5, rise: 18 },
  { left: '6%', top: '52%', w: 78, h: 34, color: '#8fbf9e', dur: 6.8, rise: 12 },
  { left: '82%', top: '46%', w: 84, h: 36, color: '#e6c98a', right: true, dur: 8, rise: 16 },
  { left: '18%', top: '78%', w: 70, h: 34, color: 'var(--accent)', dots: true, dur: 5.5, rise: 14 },
  { left: '74%', top: '80%', w: 60, h: 30, color: '#8fbf9e', right: true, dur: 7, rise: 20 },
  { left: '46%', top: '7%', w: 74, h: 34, color: 'var(--accent)', dur: 6.2, rise: 16 },
];

export function Huddle() {
  return (
    <div className="auth-bg" aria-hidden="true">
      {BUBBLES.map((b, i) => {
        const style = {
          left: b.left,
          top: b.top,
          width: b.w,
          height: b.h,
          '--c': b.color,
          '--rise': `${b.rise}px`,
          animationDuration: `${b.dur}s`,
          animationDelay: `${i * -1.3}s`,
        } as CSSProperties;
        return (
          <div key={i} className={`bub${b.right ? ' r' : ''}`} style={style}>
            {b.dots && (
              <div className="dots">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
