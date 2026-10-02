/**
 * A harness, not part of the app and not in the bundle: it mounts the real
 * MessageList with the real stylesheet so its scroll behaviour can be driven in
 * a real browser, which is the only place row heights exist.
 *
 * This exists because the "open a thread at its newest message" bug came back
 * twice. It cannot be caught by `bun test`: it is entirely a question of
 * measured layout, and in jsdom every height is zero. `dev/scroll-check.ts`
 * drives this page in headless Chrome and asserts the positions.
 *
 *   cd packages/web && bunx vite --port 5199        # serve this page
 *   bun run packages/web/dev/scroll-check.ts        # drive it, from the repo root
 *
 * The two conversations have messages of deliberately uneven length, above and
 * below the 56px guess the list starts from, because the bug only appears when
 * the guesses are wrong.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageList } from '@/features/chat/components/MessageList.tsx';
import type { ChatMessage } from '@/features/chat/store/chatStore.ts';
import '@/styles/app.css';

function make(convId: string, n: number, seed: number): ChatMessage[] {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => {
    // Heights deliberately all over the place, above and below the 56px guess.
    const words = (i * seed) % 7 === 0 ? 70 : i % 3 === 0 ? 1 : 9;
    return {
      id: `${convId}-${i}`,
      conversationId: convId,
      senderId: i % 2 ? 'me' : 'them',
      seq: i + 1,
      sentAt: now - (n - i) * 60_000,
      mine: i % 2 === 1,
      text: Array.from({ length: words }, (_, w) => `w${w}`).join(' '),
      status: 'read' as const,
    };
  });
}

const SETS: Record<string, ChatMessage[]> = { a: make('a', 40, 3), b: make('b', 14, 5) };

function Harness() {
  const [id, setId] = useState('a');
  const [extra, setExtra] = useState<Record<string, ChatMessage[]>>({ a: [], b: [] });
  const w = window as unknown as Record<string, unknown>;
  w.__switch = (next: string) => setId(next);
  w.__append = (text: string) =>
    setExtra((e) => ({
      ...e,
      [id]: [
        ...(e[id] ?? []),
        {
          id: `${id}-x-${(e[id] ?? []).length}`,
          conversationId: id,
          senderId: 'them',
          seq: 1000 + (e[id] ?? []).length,
          sentAt: Date.now(),
          mine: false,
          text,
          status: 'read' as const,
        },
      ],
    }));
  const messages = [...(SETS[id] ?? []), ...(extra[id] ?? [])];
  return (
    <div className="frame">
      <div className="stage">
        <div className="app" data-view="thread" style={{ gridTemplateColumns: '1fr' }}>
          <div className="thread">
            <div className="thread-head"><span className="th-name">conversation {id}</span></div>
            <MessageList key={id} messages={messages} isGroup={false} nameOf={() => 'Them'} typingNames={[]} />
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
