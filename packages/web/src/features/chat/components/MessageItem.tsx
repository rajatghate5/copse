/**
 * One message bubble. Wrapped in React.memo so typing in the composer, or a new
 * message arriving, never re-renders bubbles whose props are unchanged - the
 * single most important render optimisation in a chat list.
 */

import { memo } from 'react';
import type { ChatMessage, Delivery } from '@/features/chat/store/chatStore.ts';
import { expiryLabel, messageTime } from '@/lib/format.ts';
import { Check } from '@/assets/svgs/check/index.tsx';
import { CheckDouble } from '@/assets/svgs/check-double/index.tsx';
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
        {message.mine && <Ticks status={message.status} />}
      </div>
    </div>
  );
}

/**
 * Clock while queued, one tick once the server has it, two once another member's
 * device has it, two in the theme's accent once someone has read it. The label
 * carries the same four states, because a tick count and a tint are not
 * something everyone can see.
 */
const TICKS: Record<Delivery, { icon: 'clock' | 'one' | 'two'; tint: string; label: string }> = {
  pending: { icon: 'clock', tint: 'var(--faint)', label: 'Queued' },
  sent: { icon: 'one', tint: 'var(--me-ink)', label: 'Sent' },
  delivered: { icon: 'two', tint: 'var(--me-ink)', label: 'Delivered' },
  read: { icon: 'two', tint: 'var(--accent-ink)', label: 'Read' },
};

function Ticks({ status }: { status: Delivery }) {
  const t = TICKS[status];
  return (
    <span className={`status${status === 'read' ? ' read' : ''}`} style={{ color: t.tint }} title={t.label}>
      {t.icon === 'clock' ? <Clock /> : t.icon === 'one' ? <Check /> : <CheckDouble />}
      <span className="sr-only">{t.label}</span>
    </span>
  );
}

export const MessageItem = memo(MessageItemBase);
