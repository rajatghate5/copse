/**
 * What you can do to one message: reply to it, forward it, or - if you wrote it
 * - edit it.
 *
 * A sheet rather than a popover anchored to the bubble. The bubbles live in a
 * virtualised, variable-height list that re-measures and scrolls itself, so
 * anything positioned against one is positioned against a moving target; and a
 * sheet is the shape that works with a thumb as well as a cursor.
 */

import type { ChatMessage } from '@/features/chat/store/chatStore.ts';

interface Props {
  message: ChatMessage;
  /** Whether there is anywhere else to forward it to. */
  canForward: boolean;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onClose: () => void;
}

export function MessageActions({ message, canForward, onReply, onForward, onEdit, onClose }: Props) {
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet acts" role="dialog" aria-label="Message actions">
        {/* What is being acted on, so a sheet opened by a mis-tap is obvious. */}
        <div className="act-preview">{message.text || '(no text)'}</div>
        <button className="act" onClick={onReply}>Reply</button>
        <button className="act" disabled={!canForward} onClick={onForward}>
          Forward{!canForward && <span className="act-note">no other conversation yet</span>}
        </button>
        {message.mine && (
          <button className="act" onClick={onEdit}>
            Edit<span className="act-note">everyone sees it was edited</span>
          </button>
        )}
        <button className="btn secondary" style={{ marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
