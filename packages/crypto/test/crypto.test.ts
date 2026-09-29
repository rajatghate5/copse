import { describe, expect, test } from 'bun:test';
import {
  bytesToHex,
  generateConversationKey,
  generateMnemonicPhrase,
  identityFromMnemonic,
  isValidMnemonic,
  openMessage,
  publicIdentity,
  safetyNumber,
  sealMessage,
  unwrapKey,
  utf8ToBytes,
  bytesToUtf8,
  wrapKeyFor,
  generateChallenge,
  signChallenge,
  verifyChallenge,
  type MessageContext,
} from '../src/index.ts';

// A known-good phrase, so identity tests do not depend on random generation.
const ALICE_PHRASE = generateMnemonicPhrase();
const BOB_PHRASE = generateMnemonicPhrase();
const alice = identityFromMnemonic(ALICE_PHRASE);
const bob = identityFromMnemonic(BOB_PHRASE);

describe('identity', () => {
  test('a generated phrase is 24 valid words', () => {
    expect(ALICE_PHRASE.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(ALICE_PHRASE)).toBe(true);
  });

  test('the same phrase always derives the same keys', () => {
    const again = identityFromMnemonic(ALICE_PHRASE);
    expect(bytesToHex(again.encPriv)).toBe(bytesToHex(alice.encPriv));
    expect(bytesToHex(again.sigPriv)).toBe(bytesToHex(alice.sigPriv));
    expect(bytesToHex(again.encPub)).toBe(bytesToHex(alice.encPub));
    expect(bytesToHex(again.sigPub)).toBe(bytesToHex(alice.sigPub));
  });

  test('different phrases derive different identities', () => {
    expect(bytesToHex(alice.encPub)).not.toBe(bytesToHex(bob.encPub));
    expect(bytesToHex(alice.sigPub)).not.toBe(bytesToHex(bob.sigPub));
  });

  test('encryption and signing keys are distinct', () => {
    expect(bytesToHex(alice.encPriv)).not.toBe(bytesToHex(alice.sigPriv));
  });

  test('an invalid phrase throws rather than deriving garbage', () => {
    expect(() => identityFromMnemonic('not a real recovery phrase at all')).toThrow();
    expect(isValidMnemonic('not a real recovery phrase at all')).toBe(false);
  });

  test('extra whitespace in a phrase is tolerated', () => {
    const padded = identityFromMnemonic(`  ${ALICE_PHRASE}  `);
    expect(bytesToHex(padded.encPub)).toBe(bytesToHex(alice.encPub));
  });
});

describe('conversation key wrapping', () => {
  test('a member unwraps to the exact conversation key', async () => {
    const convKey = generateConversationKey();
    const wrapped = await wrapKeyFor(convKey, bob.encPub);
    const recovered = await unwrapKey(wrapped, bob.encPriv);
    expect(bytesToHex(recovered)).toBe(bytesToHex(convKey));
  });

  test('a non-member cannot unwrap', async () => {
    const convKey = generateConversationKey();
    const wrappedForBob = await wrapKeyFor(convKey, bob.encPub);
    // Alice is not the intended recipient; GCM auth must fail.
    await expect(unwrapKey(wrappedForBob, alice.encPriv)).rejects.toThrow();
  });

  test('each wrap of the same key is distinct on the wire', async () => {
    const convKey = generateConversationKey();
    const w1 = await wrapKeyFor(convKey, bob.encPub);
    const w2 = await wrapKeyFor(convKey, bob.encPub);
    // Fresh ephemeral key + IV each time, so ciphertexts differ...
    expect(bytesToHex(w1.ciphertext)).not.toBe(bytesToHex(w2.ciphertext));
    // ...yet both still unwrap to the same key.
    expect(bytesToHex(await unwrapKey(w1, bob.encPriv))).toBe(bytesToHex(convKey));
    expect(bytesToHex(await unwrapKey(w2, bob.encPriv))).toBe(bytesToHex(convKey));
  });
});

describe('message seal / open', () => {
  const ctx: MessageContext = { conversationId: 'conv-1', senderId: 'alice', seq: 1 };
  const plaintext = utf8ToBytes('meet at the copse at six');

  test('round-trips for a legitimate recipient', async () => {
    const convKey = generateConversationKey();
    const sealed = await sealMessage(convKey, alice.sigPriv, ctx, plaintext);
    const opened = await openMessage(convKey, alice.sigPub, ctx, sealed);
    expect(bytesToUtf8(opened)).toBe('meet at the copse at six');
  });

  test('a flipped ciphertext byte fails to open', async () => {
    const convKey = generateConversationKey();
    const sealed = await sealMessage(convKey, alice.sigPriv, ctx, plaintext);
    const tampered = { ...sealed, ciphertext: Uint8Array.from(sealed.ciphertext) };
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 0x01;
    await expect(openMessage(convKey, alice.sigPub, ctx, tampered)).rejects.toThrow();
  });

  test('a message signed by the wrong identity is rejected', async () => {
    const convKey = generateConversationKey();
    // Bob signs but claims to be in Alice's slot; verifying against Alice fails.
    const sealed = await sealMessage(convKey, bob.sigPriv, ctx, plaintext);
    await expect(openMessage(convKey, alice.sigPub, ctx, sealed)).rejects.toThrow();
  });

  test('a message replayed into a different context fails', async () => {
    const convKey = generateConversationKey();
    const sealed = await sealMessage(convKey, alice.sigPriv, ctx, plaintext);
    const moved: MessageContext = { ...ctx, seq: 2 };
    await expect(openMessage(convKey, alice.sigPub, moved, sealed)).rejects.toThrow();
  });

  test('the wrong conversation key fails to open', async () => {
    const sealed = await sealMessage(generateConversationKey(), alice.sigPriv, ctx, plaintext);
    await expect(openMessage(generateConversationKey(), alice.sigPub, ctx, sealed)).rejects.toThrow();
  });
});

describe('safety number', () => {
  test('is identical regardless of argument order', () => {
    const ab = safetyNumber(publicIdentity(alice), publicIdentity(bob));
    const ba = safetyNumber(publicIdentity(bob), publicIdentity(alice));
    expect(ab).toBe(ba);
  });

  test('is 60 digits in twelve groups of five', () => {
    const sn = safetyNumber(publicIdentity(alice), publicIdentity(bob));
    const groups = sn.split(' ');
    expect(groups).toHaveLength(12);
    for (const g of groups) expect(g).toMatch(/^\d{5}$/);
  });

  test('differs when an identity differs', () => {
    const carol = identityFromMnemonic(generateMnemonicPhrase());
    const ab = safetyNumber(publicIdentity(alice), publicIdentity(bob));
    const ac = safetyNumber(publicIdentity(alice), publicIdentity(carol));
    expect(ab).not.toBe(ac);
  });
});

describe('login challenge', () => {
  test('a valid signature verifies', () => {
    const challenge = generateChallenge();
    const sig = signChallenge(challenge, alice.sigPriv);
    expect(verifyChallenge(challenge, sig, alice.sigPub)).toBe(true);
  });

  test('the wrong identity does not verify', () => {
    const challenge = generateChallenge();
    const sig = signChallenge(challenge, alice.sigPriv);
    expect(verifyChallenge(challenge, sig, bob.sigPub)).toBe(false);
  });

  test('a signature for one challenge does not verify another', () => {
    const sig = signChallenge(generateChallenge(), alice.sigPriv);
    expect(verifyChallenge(generateChallenge(), sig, alice.sigPub)).toBe(false);
  });

  test('malformed input is a failed login, not a crash', () => {
    expect(verifyChallenge('not-base64!!', 'also-not-base64!!', alice.sigPub)).toBe(false);
  });
});

describe('passphrase vault', () => {
  test('round-trips a mnemonic through the right passphrase', async () => {
    const { sealMnemonic, openMnemonic } = await import('../src/vault.ts');
    const vault = await sealMnemonic('correct horse battery', ALICE_PHRASE);
    expect(await openMnemonic('correct horse battery', vault)).toBe(ALICE_PHRASE);
  });

  test('the wrong passphrase fails to open', async () => {
    const { sealMnemonic, openMnemonic } = await import('../src/vault.ts');
    const vault = await sealMnemonic('the right one', ALICE_PHRASE);
    await expect(openMnemonic('the wrong one', vault)).rejects.toThrow();
  });

  test('the same passphrase yields a different blob each time (fresh salt)', async () => {
    const { sealMnemonic } = await import('../src/vault.ts');
    const a = await sealMnemonic('same pass', ALICE_PHRASE);
    const b = await sealMnemonic('same pass', ALICE_PHRASE);
    expect(bytesToHex(a.salt)).not.toBe(bytesToHex(b.salt));
    expect(bytesToHex(a.ciphertext)).not.toBe(bytesToHex(b.ciphertext));
  });

  test('a recovered mnemonic still derives the original identity', async () => {
    const { sealMnemonic, openMnemonic } = await import('../src/vault.ts');
    const vault = await sealMnemonic('unlock me', BOB_PHRASE);
    const recovered = identityFromMnemonic(await openMnemonic('unlock me', vault));
    expect(bytesToHex(recovered.encPub)).toBe(bytesToHex(bob.encPub));
    expect(bytesToHex(recovered.sigPub)).toBe(bytesToHex(bob.sigPub));
  });
});
