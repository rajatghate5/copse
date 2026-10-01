/**
 * The welcome backdrop: mounts the private-network animation (lib/privateNetwork)
 * onto a canvas and tears it down on unmount. A thin React wrapper around the pure
 * module - all the WebGL lives in the lib, none in the component.
 */

import { useEffect, useRef } from 'react';

export function PrivateNetwork() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let active = true;
    let dispose = () => {};
    // Lazy-load so three.js ships in its own chunk, fetched only on the welcome
    // screen - the chat (logged-in) bundle stays small and fast.
    import('@/lib/privateNetwork.ts')
      .then(({ createPrivateNetwork }) => {
        if (active && ref.current) dispose = createPrivateNetwork(ref.current);
      })
      .catch(() => {
        /* WebGL or chunk fetch failed: the gradient backdrop is a fine fallback */
      });
    return () => { active = false; dispose(); };
  }, []);
  return (
    <div className="auth-bg" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
