/**
 * Mentions are parsed in one place because three parts of the app have to agree
 * about them - the composer's completions, the bubble's highlighting, and
 * whether a notification says someone named you. A disagreement shows up as a
 * highlight with no notification, or a notification for a mention nobody can
 * see, so the parsing is worth pinning down.
 *
 * Pure string work with no DOM, which is why it can live in `bun test` at all;
 * the rest of the web package needs a browser.
 */

import { describe, expect, test } from 'bun:test';
import { isEveryone, mentions, mentionsEveryone, pendingHandle, splitMentions } from '../src/features/chat/mentions.ts';

describe('splitMentions', () => {
  test('leaves text with no mention in one piece', () => {
    expect(splitMentions('just a message')).toEqual([{ text: 'just a message' }]);
  });

  test('picks out a mention and keeps the text around it', () => {
    expect(splitMentions('hey @ana look')).toEqual([
      { text: 'hey ' },
      { text: '@ana', handle: 'ana' },
      { text: ' look' },
    ]);
  });

  test('matches at the very start and the very end', () => {
    expect(splitMentions('@ana')).toEqual([{ text: '@ana', handle: 'ana' }]);
    expect(splitMentions('ping @ana')).toEqual([{ text: 'ping ' }, { text: '@ana', handle: 'ana' }]);
  });

  test('finds several, including back to back', () => {
    const parts = splitMentions('@ana @devi both');
    expect(parts.filter((p) => p.handle).map((p) => p.handle)).toEqual(['ana', 'devi']);
  });

  test('is not fooled by an email address', () => {
    // The @ follows a handle character, so "example" is not a mention.
    expect(splitMentions('mail@example today').every((p) => !p.handle)).toBe(true);
  });

  test('ignores a bare @ and anything too short to be a username', () => {
    expect(splitMentions('@ hello').every((p) => !p.handle)).toBe(true);
    expect(splitMentions('@ab').every((p) => !p.handle)).toBe(true);
  });

  test('keeps the text as typed but matches case-insensitively', () => {
    const parts = splitMentions('hi @Ana');
    expect(parts[1]).toEqual({ text: '@Ana', handle: 'ana' });
  });

  test('rejoins to exactly the original message', () => {
    for (const text of ['@ana hi @devi', 'mail@example', 'none here', '@ana', 'a @b @ana z']) {
      expect(splitMentions(text).map((p) => p.text).join('')).toBe(text);
    }
  });

  test('stops at a character a username cannot contain', () => {
    expect(splitMentions('@ana, and you?')[0]).toEqual({ text: '@ana', handle: 'ana' });
  });
});

describe('mentions', () => {
  test('matches the named handle only', () => {
    expect(mentions('hello @ana', 'ana')).toBe(true);
    expect(mentions('hello @ana', 'devi')).toBe(false);
  });

  test('ignores case on both sides', () => {
    expect(mentions('hello @ANA', 'ana')).toBe(true);
    expect(mentions('hello @ana', 'ANA')).toBe(true);
  });

  test('does not match a handle that is only a prefix of the one written', () => {
    // Otherwise "ana" would be notified by a message naming "anabel".
    expect(mentions('hello @anabel', 'ana')).toBe(false);
  });

  test('is not triggered by an email address', () => {
    expect(mentions('write to ana@example.com', 'example')).toBe(false);
  });
});

describe('pendingHandle', () => {
  test('finds the fragment being typed', () => {
    expect(pendingHandle('hey @an', 7)).toEqual({ query: 'an', from: 4 });
  });

  test('offers everything right after the @', () => {
    expect(pendingHandle('hey @', 5)).toEqual({ query: '', from: 4 });
  });

  test('stops once a space has been typed', () => {
    expect(pendingHandle('hey @ana and', 12)).toBeNull();
  });

  test('ignores an @ inside a word', () => {
    expect(pendingHandle('mail@exa', 8)).toBeNull();
  });

  test('reads from the caret, not the end of the text', () => {
    // Caret sits just after "@an"; the rest of the line must not matter.
    expect(pendingHandle('hey @an rest of it', 7)).toEqual({ query: 'an', from: 4 });
  });

  test('is null when there is no @ before the caret', () => {
    expect(pendingHandle('plain text', 5)).toBeNull();
  });
});

describe('@guys - naming everyone', () => {
  test('the group handles are recognised', () => {
    expect(isEveryone('guys')).toBe(true);
    expect(isEveryone('everyone')).toBe(true);
    expect(isEveryone('all')).toBe(true);
    expect(isEveryone('ana')).toBe(false);
  });

  test('a message naming everyone is found as such', () => {
    expect(mentionsEveryone('morning @guys')).toBe(true);
    expect(mentionsEveryone('morning @ana')).toBe(false);
  });

  test('naming everyone names you, whoever you are', () => {
    // This is what makes @guys notify the whole group: the same check the
    // notification uses for your own handle has to answer yes.
    expect(mentions('morning @guys', 'ana')).toBe(true);
    expect(mentions('morning @guys', 'devi')).toBe(true);
    expect(mentions('morning @everyone', 'ana')).toBe(true);
    expect(mentions('morning @all', 'ana')).toBe(true);
  });

  test('a message to one person does not reach everyone', () => {
    expect(mentions('morning @ana', 'devi')).toBe(false);
  });

  test('it is still just a mention in the text', () => {
    expect(splitMentions('hi @guys!')[1]).toEqual({ text: '@guys', handle: 'guys' });
  });

  test('a word that merely starts with one is not it', () => {
    expect(mentionsEveryone('@guysnight out')).toBe(false);
    expect(mentionsEveryone('@allan is here')).toBe(false);
  });
});
