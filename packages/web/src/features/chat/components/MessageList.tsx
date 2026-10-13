/**
 * The message stream, virtualised with react-window so a long history renders
 * only the visible bubbles instead of thousands of DOM nodes. Heights vary, so
 * each row measures itself and feeds its height back to the list's height cache.
 *
 * Auto-scroll is deliberate: we jump to the newest message only when the reader
 * is already at the end, so arriving messages never yank someone away from
 * older text they're reading.
 *
 * "Already at the end" has to mean the reader's own scrolling, which is the
 * whole difficulty here. A row's height is unknown until it has rendered, so
 * opening a thread scrolls to the end using 56px guesses, the real heights land,
 * the content grows underneath, and the end is suddenly far below the viewport -
 * which, measured by position, looks exactly like someone who scrolled up to
 * read. Treat it as that and the list unpins itself and sits in old messages.
 *
 * Position cannot tell the two apart, and neither can the scroll event: the one
 * our own scrollToRow causes is a plain native scroll, indistinguishable from a
 * wheel. So the pin is dropped on evidence the reader actually did something - a
 * wheel, a drag, a touch, a key - and a scroll with no such input behind it is
 * taken for what it is, the layout settling. Every measurement that moves the
 * end re-follows it while pinned, so a thread lands on the newest message
 * however wrong the first guess was.
 *
 * The component is keyed by conversation where it's used, so the height cache
 * and the pin start clean per thread rather than aiming the new thread with the
 * old one's measurements.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { List, useDynamicRowHeight, useListRef, type RowComponentProps } from 'react-window';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';
import { dayLabel } from '@/lib/format.ts';
import { MessageItem } from '@/features/chat/components/MessageItem.tsx';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: ChatMessage; showSender: boolean; senderName: string }
  | { kind: 'typing'; key: string; label: string };

/** What each row needs, handed to the row component through the list. */
interface RowData {
  rows: Row[];
  isGroup: boolean;
  myHandle: string;
  onAct: (message: ChatMessage, anchor: DOMRect) => void;
  measure: (index: number, height: number) => void;
}

interface Props {
  messages: ChatMessage[];
  isGroup: boolean;
  nameOf: (userId: string) => string;
  typingNames: string[];
  /** This account's handle, so a mention of you reads differently. */
  myHandle: string;
  /** Open the actions for one message, anchored to the control pressed. */
  onAct: (message: ChatMessage, anchor: DOMRect) => void;
}

/**
 * Who is typing, in words. The names were always known here - they came down
 * the hook and into the row - but only the three dots were ever drawn, with the
 * name left in an aria-label where no one sees it. In a group that is the whole
 * question the indicator is meant to answer.
 */
function typingPhrase(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'} are typing`;
}

/**
 * One row. The outer div is the list's own positioning; the inner one is the
 * content whose natural height is what we report back - measuring the outer
 * would just read back the guess the list is already using.
 */
function MessageRow({ index, style, rows, isGroup, myHandle, onAct, measure }: RowComponentProps<RowData>) {
  const row = rows[index]!;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rowRef.current) measure(index, rowRef.current.getBoundingClientRect().height);
  });
  return (
    <div style={style}>
      <div ref={rowRef} style={{ padding: '0 18px 9px' }}>
        {row.kind === 'day' && <div className="day">{row.label}</div>}
        {row.kind === 'msg' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <MessageItem message={row.message} showSender={row.showSender} senderName={row.senderName} myHandle={myHandle} isGroup={isGroup} onAct={onAct} />
          </div>
        )}
        {row.kind === 'typing' && (
          <div className="typing-row">
            <div className="typing-b" aria-hidden="true">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
            {/* The dots say someone is; the name says who. */}
            <span className="typing-who" role="status">{row.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const rowKey = (index: number, data: RowData) => data.rows[index]!.key;

export function MessageList({ messages, isGroup, nameOf, typingNames, myHandle, onAct }: Props) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
    let lastSender = '';
    for (const m of messages) {
      const day = dayLabel(m.sentAt);
      if (day !== lastDay) {
        out.push({ kind: 'day', key: `day-${day}-${m.id}`, label: day });
        lastDay = day;
        lastSender = '';
      }
      out.push({
        kind: 'msg',
        key: m.id,
        message: m,
        showSender: isGroup && !m.mine && m.senderId !== lastSender,
        senderName: nameOf(m.senderId),
      });
      lastSender = m.senderId;
    }
    if (typingNames.length > 0) {
      out.push({ kind: 'typing', key: 'typing', label: typingPhrase(typingNames) });
    }
    return out;
  }, [messages, isGroup, nameOf, typingNames]);

  const listRef = useListRef(null);
  const heights = useDynamicRowHeight({ defaultRowHeight: 56 });
  /** Follow the newest message, until the reader scrolls away themselves. */
  const pinned = useRef(true);

  // A measurement can land a frame after the rows changed, so the chase below
  // reads the current rows from a ref rather than the render it was created in.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const toEnd = useCallback(() => {
    const last = rowsRef.current.length - 1;
    if (last >= 0) listRef.current?.scrollToRow({ index: last, align: 'end' });
  }, [listRef]);

  const measure = useCallback((index: number, height: number) => {
    if (heights.getRowHeight(index) === height) return;
    heights.setRowHeight(index, height);
    // The row just changed the total height, so the end has moved away from
    // wherever we last scrolled. Chase it until the heights stop changing.
    if (pinned.current) requestAnimationFrame(toEnd);
  }, [heights, toEnd]);

  // Stick to the end when the stream grows and we were already there. Keyed on
  // the last row too, not only the count: a reconciled echo or a day divider can
  // change what the end is without changing how many rows there are.
  const lastKey = rows[rows.length - 1]?.key ?? '';
  useEffect(() => {
    if (pinned.current) toEnd();
  }, [rows.length, lastKey, toEnd]);

  /**
   * Evidence that a scroll is the reader's. A wheel or a touch is a moment, so
   * it counts for a short window afterwards (the scroll events it causes arrive
   * over the following frames); a pointer held on the scrollbar counts for as
   * long as it is held, which a window-level mouseup ends even if released off
   * the element.
   */
  const heldDown = useRef(false);
  const intentUntil = useRef(0);
  // A flick keeps scrolling long after the finger is gone, so a touch counts for
  // longer than a wheel tick - those momentum frames are still the reader's.
  const noteIntent = (ms = 700) => { intentUntil.current = Math.max(intentUntil.current, performance.now() + ms); };
  const readerScrolled = () => heldDown.current || performance.now() < intentUntil.current;

  useEffect(() => {
    const mouseUp = () => { heldDown.current = false; noteIntent(); };
    const touchEnd = () => { heldDown.current = false; noteIntent(2000); };
    window.addEventListener('mouseup', mouseUp);
    window.addEventListener('touchend', touchEnd);
    return () => {
      window.removeEventListener('mouseup', mouseUp);
      window.removeEventListener('touchend', touchEnd);
    };
  }, []);

  const rowProps = useMemo<RowData>(
    () => ({ rows, isGroup, myHandle, onAct, measure }),
    [rows, isGroup, myHandle, onAct, measure],
  );

  return (
    // The input listeners sit on the wrapper, so they catch everything inside
    // the virtualised list - including a drag of its scrollbar - without the
    // list having to forward them.
    <div
      className="stream"
      style={{ padding: 0 }}
      onWheel={() => noteIntent()}
      onTouchMove={() => noteIntent(2000)}
      onKeyDown={() => noteIntent()}
      onMouseDown={() => { heldDown.current = true; noteIntent(); }}
    >
      <List
        listRef={listRef}
        rowCount={rows.length}
        rowHeight={heights}
        rowComponent={MessageRow}
        rowProps={rowProps}
        rowKey={rowKey}
        // The list sizes itself to this pane, which can appear after the rows do
        // (a hidden pane, a resize) - and a list with no height cannot scroll,
        // so land on the end once it has one.
        onResize={() => { if (pinned.current) toEnd(); }}
        onScroll={(e) => {
          // Position only means something when the reader has just done
          // something to cause the scroll; otherwise it is our own scrollToRow,
          // or the heights still settling underneath it.
          if (!readerScrolled()) return;
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      />
    </div>
  );
}
