/**
 * One message bubble. Wrapped in React.memo so typing in the composer, or a new
 * message arriving, never re-renders bubbles whose props are unchanged - the
 * single most important render optimisation in a chat list.
 */

import { memo } from 'react';
import type { ChatMessage, Delivery } from '@/features/chat/store/chatStore.ts';
import { splitMentions } from '@/features/chat/mentions.ts';
import { expiryLabel, messageTime } from '@/lib/format.ts';
import { Check } from '@/assets/svgs/check/index.tsx';
import { CheckDouble } from '@/assets/svgs/check-double/index.tsx';
import { Clock } from '@/assets/svgs/clock/index.tsx';
import { ChevronDown } from '@/assets/svgs/chevron-down/index.tsx';

interface Props {
  message: ChatMessage;
  showSender: boolean;
  senderName: string;
  /** This account's handle, so a mention of you can be marked as yours. */
  myHandle: string;
  /** Whether this conversation has more than two people in it. */
  isGroup: boolean;
  /**
   * Open the actions for this message. The trigger's rect goes with it, because
   * the menu is anchored to where the control was when it was pressed.
   */
  onAct?: (message: ChatMessage, anchor: DOMRect) => void;
}

/**
 * The body, with @mentions picked out. Split into parts and rendered as
 * elements - never as markup - because the text came out of a message someone
 * else sealed, and the one thing it must never be able to do is become HTML.
 */
function Body({ text, myHandle }: { text: string; myHandle: string }) {
  const parts = splitMentions(text);
  if (parts.length === 1 && !parts[0]!.handle) return <>{text}</>;
  const me = myHandle.toLowerCase();
  return (
    <>
      {parts.map((p, i) =>
        p.handle ? (
          <span key={i} className={`mention${p.handle === me ? ' me' : ''}`}>{p.text}</span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function MessageItemBase({ message, showSender, senderName, myHandle, isGroup, onAct }: Props) {
  const expiry = expiryLabel(message.sentAt);
  return (
    <div className={`bubble ${message.mine ? 'me' : 'them'}`}>
      {showSender && !message.mine && <div className="sender">{senderName}</div>}
      {message.forwardedFrom && (
        <div className="fwd">Forwarded from {message.forwardedFrom}</div>
      )}
      {message.quote && (
        // The quoted snippet travels inside the message, so it still shows when
        // the original has expired or was sent before you joined.
        <div className="quote">
          <span className="q-by">{message.quote.by}</span>
          <span className="q-text">{message.quote.text}</span>
        </div>
      )}
      <span className="t"><Body text={message.text} myHandle={myHandle} /></span>
      <div className="meta">
        <span className="ts">{messageTime(message.sentAt)}</span>
        {/* Said plainly rather than hidden: the others saw the first version. */}
        {message.editedAt ? <span className="edited">edited</span> : null}
        {expiry && <span className="exp">{expiry}</span>}
        {/* Only in a group, and only for your own: in a direct chat the second
            tick already means the one other person, and a "seen by 1" beside it
            would be the same fact written twice. */}
        {message.mine && isGroup && (message.seenBy ?? 0) > 0 && (
          <span className="seen">Seen by {message.seenBy}</span>
        )}
        {message.mine && <Ticks status={message.status} />}
      </div>
      {onAct && (
        <button
          type="button"
          className="b-act"
          aria-label="Message actions"
          aria-haspopup="menu"
          onClick={(e) => onAct(message, e.currentTarget.getBoundingClientRect())}
        >
          <ChevronDown />
        </button>
      )}
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
