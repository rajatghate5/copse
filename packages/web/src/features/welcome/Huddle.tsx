/**
 * The welcome backdrop: a copse of chat. A small cluster of message bubbles that
 * breathe together — the name (a copse: a little huddle) and the product (chat) in
 * one idea. Pure CSS/DOM, no WebGL; the gradient behind it carries the rest, and
 * the breathing pauses under prefers-reduced-motion (handled in the stylesheet).
 */

import type { CSSProperties } from 'react';

interface Bubble {
  left: number;
  top: number;
  w: number;
  h: number;
  color: string;
  right?: boolean;
  dots?: boolean;
}

// A deliberate, hand-placed cluster — not a grid. Coordinates are within the
// .huddle box (see app.css); the staggered delay makes them breathe out of sync.
const BUBBLES: Bubble[] = [
  { left: 0, top: 10, w: 86, h: 34, color: '#dcebe0' },
  { left: 80, top: 50, w: 70, h: 30, color: 'var(--accent)', right: true },
  { left: 26, top: 90, w: 96, h: 36, color: '#8fbf9e' },
  { left: 110, top: 0, w: 58, h: 28, color: '#e6c98a', right: true },
  { left: 50, top: 136, w: 54, h: 30, color: 'var(--accent)', dots: true },
];

export function Huddle() {
  return (
    <div className="auth-bg" aria-hidden="true">
      <div className="huddle">
        {BUBBLES.map((b, i) => {
          const style = {
            left: b.left,
            top: b.top,
            width: b.w,
            height: b.h,
            '--c': b.color,
            animationDelay: `${i * 0.35}s`,
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
    </div>
  );
}
