/**
 * @copse/crypto - every cryptographic operation Copse performs, and nothing
 * else. Pure functions over bytes, no I/O, no network, no storage. That is what
 * makes it testable in isolation and safe to run identically on client and
 * server.
 *
 * The split of labour:
 *   - identity      keys from a recovery phrase
 *   - conversation  wrapping the shared key to each member (server sees nothing)
 *   - message       encrypt + sign / verify + decrypt one message
 *   - safety        the human-verifiable fingerprint that catches a lying server
 *   - challenge     password-free login by signing a nonce
 *   - aead, bytes   the primitives the above are built from
 */

export * from './bytes.ts';
export * from './identity.ts';
export * from './aead.ts';
export * from './conversation.ts';
export * from './message.ts';
export * from './safety.ts';
export * from './challenge.ts';
export * from './vault.ts';
