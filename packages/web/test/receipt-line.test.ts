/**
 * The one line in a message's menu that says what became of it. Five branches,
 * and the one that matters most is the disagreement: a message the server calls
 * read, with no per-reader rows to count, must never be described as unread.
 * That combination is real - every message read before message_reads existed is
 * in it - and it is what the group saw.
 */

import { describe, expect, test } from 'bun:test';
import { receiptLine } from '../src/features/chat/components/MessageMenu.tsx';
import type { ChatMessage, Delivery } from '../src/features/chat/store/chatStore.ts';

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'me',
    seq: 1,
    sentAt: Date.now(),
    mine: true,
    text: 'hello',
    status: 'sent' as Delivery,
    ...over,
  };
}

describe('somebody else wrote it', () => {
  test('there is nothing to report', () => {
    expect(receiptLine(msg({ mine: false }), true, 3)).toBeNull();
  });
});

describe('in a group', () => {
  test('counts the readers out of the others', () => {
    expect(receiptLine(msg({ status: 'read', seenBy: 2 }), true, 3)).toBe('Read by 2 of 3');
  });

  test('says "Read all" once everyone has', () => {
    expect(receiptLine(msg({ status: 'read', seenBy: 3 }), true, 3)).toBe('Read all');
  });

  test('says "Read all" if the count somehow runs past the group', () => {
    // Someone leaving a conversation would do it; the line should not read
    // "4 of 3".
    expect(receiptLine(msg({ status: 'read', seenBy: 4 }), true, 3)).toBe('Read all');
  });

  test('a delivered message with nobody reading says so plainly', () => {
    expect(receiptLine(msg({ status: 'delivered', seenBy: 0 }), true, 3)).toBe('Nobody has read it yet');
  });

  test('a READ message with no count is never called unread', () => {
    // The tick comes from read_at, the count from rows that may predate the
    // feature. "Read by nobody" over a read tick is a contradiction.
    expect(receiptLine(msg({ status: 'read', seenBy: 0 }), true, 3)).toBe('Read');
    expect(receiptLine(msg({ status: 'read' }), true, 3)).toBe('Read');
  });

  test('a queued message is not pretending to have been delivered', () => {
    expect(receiptLine(msg({ status: 'pending' }), true, 3)).toBe('Not sent yet');
  });
});

describe('in a direct chat', () => {
  test('the state is the whole story - no "1 of 1"', () => {
    expect(receiptLine(msg({ status: 'read', seenBy: 1 }), false, 1)).toBe('Read');
    expect(receiptLine(msg({ status: 'delivered' }), false, 1)).toBe('Delivered, not read yet');
    expect(receiptLine(msg({ status: 'sent' }), false, 1)).toBe('Sent');
  });

  test('a group of one other person is treated the same way', () => {
    expect(receiptLine(msg({ status: 'read', seenBy: 1 }), true, 1)).toBe('Read all');
  });

  test('a conversation with nobody else in it does not divide by it', () => {
    expect(receiptLine(msg({ status: 'read' }), true, 0)).toBe('Read');
  });
});
