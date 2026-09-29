import { describe, expect, test } from 'bun:test';
import {
  cleanName,
  cleanB64,
  parseClientMessage,
  packWrappedKey,
  unpackWrappedKey,
  MAX_NAME_LENGTH,
} from '../src/all.ts';
import { generateConversationKey, identityFromMnemonic, generateMnemonicPhrase, wrapKeyFor, unwrapKey, bytesToHex } from '@copse/crypto';

describe('cleanName', () => {
  test('strips control characters', () => {
    // An embedded ESC must not survive into logs or other clients.
    expect(cleanName('a\u001b[31mb')).toBe('a[31mb');
    expect(cleanName('x\u0000\u0007y')).toBe('xy');
  });
  test('trims and caps length', () => {
    expect(cleanName('  spaced  ')).toBe('spaced');
    expect(cleanName('z'.repeat(100)).length).toBe(MAX_NAME_LENGTH);
  });
  test('falls back for empty or non-string input', () => {
    expect(cleanName('')).toBe('someone');
    expect(cleanName('   ')).toBe('someone');
    expect(cleanName(42)).toBe('someone');
  });
});

describe('cleanB64', () => {
  test('accepts valid base64 within length', () => {
    expect(cleanB64('QUJD', 128)).toBe('QUJD');
    expect(cleanB64('QQ==', 128)).toBe('QQ==');
  });
  test('rejects non-base64, empty, and over-length', () => {
    expect(cleanB64('not base64!', 128)).toBeNull();
    expect(cleanB64('', 128)).toBeNull();
    expect(cleanB64('QUJD', 2)).toBeNull();
    expect(cleanB64(123, 128)).toBeNull();
  });
});

describe('parseClientMessage', () => {
  test('parses a structurally valid frame', () => {
    const msg = parseClientMessage('{"t":"typing","conversationId":"c1","typing":true}');
    expect(msg?.t).toBe('typing');
  });
  test('returns null on malformed json or missing type', () => {
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage('{"x":1}')).toBeNull();
    expect(parseClientMessage('42')).toBeNull();
  });
});

describe('wrapped-key packing', () => {
  test('packs and unpacks to an equivalent wrapped key', async () => {
    const id = identityFromMnemonic(generateMnemonicPhrase());
    const convKey = generateConversationKey();
    const wrapped = await wrapKeyFor(convKey, id.encPub);
    const round = unpackWrappedKey(packWrappedKey(wrapped));
    expect(bytesToHex(round.ephPub)).toBe(bytesToHex(wrapped.ephPub));
    expect(bytesToHex(round.iv)).toBe(bytesToHex(wrapped.iv));
    expect(bytesToHex(round.ciphertext)).toBe(bytesToHex(wrapped.ciphertext));
    // And it still unwraps to the original conversation key.
    expect(bytesToHex(await unwrapKey(round, id.encPriv))).toBe(bytesToHex(convKey));
  });
  test('a truncated blob throws rather than yielding junk', () => {
    expect(() => unpackWrappedKey('AAE=')).toThrow();
  });
});
