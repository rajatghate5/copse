/**
 * The message input. Local state only - the draft text lives here and never
 * touches the store, so keystrokes don't ripple into the message list. Emits a
 * typing signal (debounced upstream) and sends on Enter or the button.
 */

import { useRef, useState } from 'react';
import { Arrow } from '@/assets/svgs/arrow/index.tsx';

interface Props {
  peerName: string;
  onSend: (text: string) => void;
  onTyping: () => void;
}

export function Composer({ peerName, onSend, onTyping }: Props) {
  const [text, setText] = useState('');
  const lastTyped = useRef(0);

  const submit = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <div className="composer">
      <input
        id="composer-input"
        className="msg"
        placeholder={`Message ${peerName}…`}
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const now = Date.now();
          if (now - lastTyped.current > 1500) {
            lastTyped.current = now;
            onTyping();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="send" aria-label="Send" disabled={!text.trim()} onClick={submit}>
        <Arrow />
      </button>
    </div>
  );
}
