/**
 * The dropdown on a message: reply, forward, or - if you wrote it - edit.
 *
 * Anchored to the control that opened it, which takes some care here. The
 * bubbles live in a virtualised list that re-measures rows and scrolls itself,
 * so a menu positioned against one is positioned against something that moves.
 * Two things keep that honest: the position is taken from the trigger's rect at
 * the moment it opens and then fixed to the viewport, so no later re-measure can
 * drag it; and any scroll closes it, because a dropdown whose anchor has slid
 * out from under it is pointing at the wrong message - the one failure worth
 * avoiding entirely.
 *
 * It also flips above the trigger when there is no room below, and is clamped
 * into the viewport, so a message at the bottom of the thread or hard against
 * the edge still gets a usable menu.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';

const GAP = 6;
const MARGIN = 8;

interface Props {
  message: ChatMessage;
  /** Where the trigger was when it was pressed. */
  anchor: DOMRect;
  /** Whether there is anywhere else to forward it to. */
  canForward: boolean;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onClose: () => void;
}

export function MessageMenu({ message, anchor, canForward, onReply, onForward, onEdit, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measured before paint, so it never appears in one place and jumps to another.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const flip = below + height > window.innerHeight - MARGIN;
    const top = flip ? Math.max(MARGIN, anchor.top - GAP - height) : below;
    // Right-aligned to the trigger, then pulled back inside the viewport.
    const wanted = anchor.right - width;
    const left = Math.min(Math.max(MARGIN, wanted), window.innerWidth - width - MARGIN);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Capture, so a scroll of the message list itself counts and not only the
    // window's: the anchor belongs to that list.
    const onScroll = () => onClose();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    // Deferred: the click that opened this would otherwise close it at once.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="msg-menu"
      role="menu"
      aria-label="Message actions"
      style={{
        top: pos?.top ?? anchor.bottom + GAP,
        left: pos?.left ?? anchor.left,
        // Hidden for the one frame before it has been measured.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <button type="button" role="menuitem" className="mm-item" autoFocus onClick={onReply}>Reply</button>
      <button type="button" role="menuitem" className="mm-item" disabled={!canForward} onClick={onForward}>
        Forward
      </button>
      {message.mine && (
        <button type="button" role="menuitem" className="mm-item" onClick={onEdit}>Edit</button>
      )}
    </div>
  );
}
