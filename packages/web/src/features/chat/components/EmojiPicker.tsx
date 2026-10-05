/**
 * A small emoji picker.
 *
 * Hand-listed rather than pulled from a library: an emoji dataset is hundreds of
 * kilobytes, and this is a chat for a handful of people who want a thumbs-up,
 * not a searchable index of every glyph Unicode has. These are the ones people
 * actually send, grouped so they can be found by eye.
 *
 * Typed emoji have always worked - the message body is UTF-8 text sealed like
 * any other - so this adds a way to find them, not a way to send them.
 */

import { useEffect, useRef } from 'react';

const GROUPS: { name: string; emoji: string[] }[] = [
  {
    name: 'Faces',
    emoji: ['😀', '😄', '😅', '😂', '🙂', '😉', '😊', '😍', '😘', '😎', '🤔', '😐', '🙄', '😬', '😴', '😢', '😭', '😡', '🥳', '🤯', '😱', '🤒', '🤝', '🙏'],
  },
  {
    name: 'Gestures',
    emoji: ['👍', '👎', '👌', '🤌', '✌️', '🤞', '👏', '🙌', '💪', '👀', '🫡', '🤙'],
  },
  {
    name: 'Hearts',
    emoji: ['❤️', '🧡', '💚', '💙', '💜', '🖤', '💔', '✨', '🔥', '💯', '🎉', '⭐'],
  },
  {
    name: 'Things',
    emoji: ['☕', '🍕', '🍻', '🎂', '🌳', '🌧️', '☀️', '🌙', '🚗', '✈️', '📷', '🎵', '⚽', '💻', '📱', '🔒', '✅', '❌', '⏰', '📌'],
  },
];

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape or on a click anywhere else - a picker that traps you is
  // worse than no picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // Deferred: the click that opened this would otherwise close it immediately.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div className="emoji-pop" ref={ref} role="dialog" aria-label="Emoji">
      {GROUPS.map((g) => (
        <div className="emoji-group" key={g.name}>
          <div className="emoji-head">{g.name}</div>
          <div className="emoji-grid">
            {g.emoji.map((e) => (
              <button
                key={e}
                type="button"
                className="emoji-btn"
                // The emoji itself is the accessible name; a screen reader
                // announces it better than any label we would invent.
                onClick={() => onPick(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
