/**
 * The message envelope. Its whole job is to carry what a message refers to
 * inside the ciphertext, so these tests are mostly about the two compatibility
 * rules: a bare string is a message, and anything unrecognised is shown rather
 * than dropped. Getting that wrong loses messages, so it is pinned down here.
 */

import { describe, expect, test } from 'bun:test';
import { decodeBody, encodeBody, quoteOf } from '../src/features/chat/body.ts';

describe('plain text', () => {
  test('a message with nothing attached is sent as bare text', () => {
    expect(encodeBody({ text: 'hello' })).toBe('hello');
  });

  test('bare text decodes to itself - messages predating the envelope', () => {
    expect(decodeBody('hello')).toEqual({ text: 'hello' });
  });

  test('text that merely looks like JSON survives', () => {
    expect(decodeBody('{not json')).toEqual({ text: '{not json' });
    expect(decodeBody('{"some":"object"}')).toEqual({ text: '{"some":"object"}' });
    expect(decodeBody('[1,2,3]')).toEqual({ text: '[1,2,3]' });
    expect(decodeBody('{}')).toEqual({ text: '{}' });
  });

  test('an unknown version is shown as written, not emptied', () => {
    const future = JSON.stringify({ v: 99, t: 'hi', something: 'new' });
    expect(decodeBody(future)).toEqual({ text: future });
  });
});

describe('round trip', () => {
  test('a quoted reply keeps the id, the author and the snippet', () => {
    const body = { text: 'agreed', quote: quoteOf('m1', 'Ana', 'shall we go at six') };
    expect(decodeBody(encodeBody(body))).toEqual(body);
  });

  test('a forward keeps who wrote it originally', () => {
    const body = { text: 'look at this', forwardedFrom: 'Devi' };
    expect(decodeBody(encodeBody(body))).toEqual(body);
  });

  test('a forwarded reply keeps both', () => {
    const body = { text: 'x', quote: quoteOf('m2', 'Ana', 'y'), forwardedFrom: 'Devi' };
    expect(decodeBody(encodeBody(body))).toEqual(body);
  });

  test('empty text is preserved, since a quote alone is a real message', () => {
    const body = { text: '', quote: quoteOf('m3', 'Ana', 'hi') };
    expect(decodeBody(encodeBody(body)).text).toBe('');
    expect(decodeBody(encodeBody(body)).quote?.id).toBe('m3');
  });
});

describe('bounds and junk', () => {
  test('a long quote is truncated rather than carried whole', () => {
    const long = 'x'.repeat(500);
    const encoded = encodeBody({ text: 'ok', quote: quoteOf('m1', 'Ana', long) });
    expect(decodeBody(encoded).quote!.text.length).toBe(140);
    expect(encoded.length).toBeLessThan(300);
  });

  test('a quote with no id is dropped, not half-rendered', () => {
    const encoded = JSON.stringify({ v: 1, t: 'hi', r: { by: 'Ana', text: 'x' } });
    expect(decodeBody(encoded)).toEqual({ text: 'hi' });
  });

  test('a quote with an unnamed author still shows', () => {
    const encoded = JSON.stringify({ v: 1, t: 'hi', r: { id: 'm1', text: 'x' } });
    expect(decodeBody(encoded).quote).toEqual({ id: 'm1', by: 'Someone', text: 'x' });
  });

  test('wrongly typed parts are ignored, and the text still arrives', () => {
    const encoded = JSON.stringify({ v: 1, t: 'hi', r: 'not an object', f: 42 });
    expect(decodeBody(encoded)).toEqual({ text: 'hi' });
  });

  test('unknown fields are ignored', () => {
    const encoded = JSON.stringify({ v: 1, t: 'hi', zzz: { a: 1 } });
    expect(decodeBody(encoded)).toEqual({ text: 'hi' });
  });
});
