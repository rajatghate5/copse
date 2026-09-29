/**
 * The message stream, virtualised with react-window so a long history renders
 * only the visible bubbles instead of thousands of DOM nodes. Heights vary, so
 * each row measures itself and feeds its height back to the list.
 *
 * Auto-scroll is deliberate: we jump to the newest message only when the reader
 * is already at the bottom, so arriving messages never yank someone away from
 * older text they're reading.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import type { ChatMessage } from '../store/chatStore.ts';
import { dayLabel } from '../../../lib/format.ts';
import { MessageItem } from './MessageItem.tsx';

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
  const heights = useRef<Record<number, number>>({});
  const atBottom = useRef(true);

  const sizeOf = (i: number) => heights.current[i] ?? 56;

  const measure = (i: number, h: number) => {
    if (heights.current[i] !== h) {
      heights.current[i] = h;
      listRef.current?.resetAfterIndex(i);
    }
  };

  // Stick to the bottom when new rows arrive and we were already there.
  useEffect(() => {
    if (atBottom.current && rows.length > 0) {
      listRef.current?.scrollToItem(rows.length - 1, 'end');
    }
  }, [rows.length]);

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
          height={height}
          width={width}
          itemCount={rows.length}
          itemSize={sizeOf}
          itemKey={(i) => rows[i]!.key}
          onItemsRendered={({ visibleStopIndex }) => {
            atBottom.current = visibleStopIndex >= rows.length - 1;
          }}
        >
          {Row}
        </VariableSizeList>
      )}
    </div>
  );
}
