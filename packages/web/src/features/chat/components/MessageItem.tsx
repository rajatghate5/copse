/**
 * One message bubble. Wrapped in React.memo so typing in the composer, or a new
 * message arriving, never re-renders bubbles whose props are unchanged - the
 * single most important render optimisation in a chat list.
 */

import { memo } from 'react';
import type { ChatMessage, Delivery } from '@/features/chat/store/chatStore.ts';
import { isEveryone, splitMentions } from '@/features/chat/mentions.ts';
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
  /** How many people are in it besides you, for the read ratio. */
  otherCount: number;
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
          // Naming everyone names you, so it is marked the same way.
          <span key={i} className={`mention${p.handle === me || isEveryone(p.handle) ? ' me' : ''}`}>{p.text}</span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function MessageItemBase({ message, showSender, senderName, myHandle, isGroup, otherCount, onAct }: Props) {
  const expiry = expiryLabel(message.sentAt);
  // Only your own messages in a group, and only once the server has one: a
  // ratio on a message still in the outbox would be counting nothing. In a
  // direct chat the second tick already means the one other person.
  const seen = message.mine && isGroup && otherCount > 0 && message.status !== 'pending'
    ? { count: message.seenBy ?? 0, of: otherCount }
    : null;
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
        {message.mine && <Ticks status={message.status} seen={seen} />}
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
 * device has it, two bright ones once someone has read it. The label carries the
 * same four states, because a tick count and a tint are not something everyone
 * can see.
 */
const TICKS: Record<Delivery, { icon: 'clock' | 'one' | 'two'; tint: string; label: string }> = {
  pending: { icon: 'clock', tint: 'var(--tick)', label: 'Queued' },
  sent: { icon: 'one', tint: 'var(--tick)', label: 'Sent' },
  delivered: { icon: 'two', tint: 'var(--tick)', label: 'Delivered' },
  read: { icon: 'two', tint: 'var(--tick-read)', label: 'Read' },
};

/**
 * `seen` is the group count: how many of the others have read it, out of how
 * many there are. Shown as a ratio because a bare "2" means nothing unless you
 * are holding the size of the group in your head, and spoken in full for anyone
 * who cannot see it.
 */
function Ticks({ status, seen }: { status: Delivery; seen: { count: number; of: number } | null }) {
  const t = TICKS[status];
  const label = seen ? `${t.label} — read by ${seen.count} of ${seen.of}` : t.label;
  return (
    <span className={`status${status === 'read' ? ' read' : ''}`} style={{ color: t.tint }} title={label}>
      {seen && <span className="seen-of" aria-hidden="true">{seen.count}/{seen.of}</span>}
      {t.icon === 'clock' ? <Clock /> : t.icon === 'one' ? <Check /> : <CheckDouble />}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export const MessageItem = memo(MessageItemBase);
