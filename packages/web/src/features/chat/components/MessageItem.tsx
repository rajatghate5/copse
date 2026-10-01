/**
 * One message bubble. Wrapped in React.memo so typing in the composer, or a new
 * message arriving, never re-renders bubbles whose props are unchanged - the
 * single most important render optimisation in a chat list.
 */

import { memo } from 'react';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';
import { expiryLabel, messageTime } from '@/lib/format.ts';
import { Check } from '@/assets/svgs/check/index.tsx';
import { Clock } from '@/assets/svgs/clock/index.tsx';

interface Props {
  message: ChatMessage;
  showSender: boolean;
  senderName: string;
}

function MessageItemBase({ message, showSender, senderName }: Props) {
  const expiry = expiryLabel(message.sentAt);
  return (
    <div className={`bubble ${message.mine ? 'me' : 'them'}`}>
      {showSender && !message.mine && <div className="sender">{senderName}</div>}
      <span className="t">{message.text}</span>
      <div className="meta">
        <span className="ts">{messageTime(message.sentAt)}</span>
        {expiry && <span className="exp">{expiry}</span>}
        {message.mine && (
          <span className="status" style={{ color: message.status === 'pending' ? 'var(--faint)' : 'var(--me-ink)' }}>
            {message.status === 'pending' ? <Clock /> : <Check />}
          </span>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemBase);
