/**
 * The message stream, virtualised with react-window so a long history renders
 * only the visible bubbles instead of thousands of DOM nodes. Heights vary, so
 * each row measures itself and feeds its height back to the list.
 *
 * Auto-scroll is deliberate: we jump to the newest message only when the reader
 * is already at the end, so arriving messages never yank someone away from
 * older text they're reading.
 *
 * "Already at the end" has to mean the reader's own scrolling, which is the
 * whole difficulty here. A row's height is unknown until it has rendered, so
 * opening a thread scrolls to the end using 56px guesses, the real heights land,
 * the content grows underneath, and the end is suddenly far below the viewport -
 * which, measured naively, looks exactly like someone who scrolled up to read.
 * It would then stop following and leave the thread parked in old messages. So
 * the pin is dropped only by a scroll event the browser attributes to the user
 * (`scrollUpdateWasRequested === false`), and every measurement that moves the
 * end re-follows it while pinned. The component is also keyed by conversation
 * where it's used, so the height cache and the pin start clean per thread rather
 * than aiming the new thread with the old one's measurements.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';
import { dayLabel } from '@/lib/format.ts';
import { MessageItem } from '@/features/chat/components/MessageItem.tsx';

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: ChatMessage; showSender: boolean; senderName: string }
  | { kind: 'typing'; key: string; label: string };

interface Props {
  messages: ChatMessage[];
  isGroup: boolean;
  nameOf: (userId: string) => string;
  typingNames: string[];
}

/** Track a container's pixel size, so the fixed-size list knows its viewport. */
function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function MessageList({ messages, isGroup, nameOf, typingNames }: Props) {
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
      out.push({ kind: 'typing', key: 'typing', label: typingNames.join(', ') });
    }
    return out;
  }, [messages, isGroup, nameOf, typingNames]);

  const { ref, width, height } = useSize();
  const listRef = useRef<VariableSizeList>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const heights = useRef<Record<number, number>>({});
  /** Follow the newest message, until the reader scrolls away themselves. */
  const pinned = useRef(true);

  const sizeOf = (i: number) => heights.current[i] ?? 56;

  const toEnd = () => {
    if (rows.length > 0) listRef.current?.scrollToItem(rows.length - 1, 'end');
  };

  const measure = (i: number, h: number) => {
    if (heights.current[i] === h) return;
    heights.current[i] = h;
    listRef.current?.resetAfterIndex(i);
    // The row just changed the total height, so the end has moved away from
    // wherever we last scrolled. Chase it until the heights stop changing.
    if (pinned.current) requestAnimationFrame(toEnd);
  };

  // Stick to the end when the stream grows and we were already there. Keyed on
  // the last row too, not only the count: a reconciled echo or a day divider can
  // change what the end is without changing how many rows there are.
  const lastKey = rows[rows.length - 1]?.key ?? '';
  useEffect(() => {
    if (pinned.current) toEnd();
  }, [rows.length, lastKey]);

  // The viewport itself can appear after the rows (a hidden pane, a resize), and
  // a list with no height cannot scroll - so land on the end once it has one.
  useEffect(() => {
    if (height > 0 && pinned.current) toEnd();
  }, [height]);

  const Row = ({ index, style }: ListChildComponentProps) => {
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
              <MessageItem message={row.message} showSender={row.showSender} senderName={row.senderName} />
            </div>
          )}
          {row.kind === 'typing' && (
            <div style={{ display: 'flex' }}>
              <div className="typing-b" aria-label={`${row.label} typing`}>
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="stream" ref={ref} style={{ padding: 0 }}>
      {width > 0 && height > 0 && (
        <VariableSizeList
          ref={listRef}
          outerRef={outerRef}
          height={height}
          width={width}
          itemCount={rows.length}
          itemSize={sizeOf}
          itemKey={(i) => rows[i]!.key}
          onScroll={({ scrollUpdateWasRequested }) => {
            // Our own scrollToItem calls report `true`; only the reader's own
            // scrolling decides whether to keep following the newest message.
            if (scrollUpdateWasRequested) return;
            const el = outerRef.current;
            if (!el) return;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {Row}
        </VariableSizeList>
      )}
    </div>
  );
}
