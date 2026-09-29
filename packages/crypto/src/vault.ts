/**
 * The passphrase vault - how a short passphrase, not a 24-word phrase, unlocks
 * an account.
 *
 * An identity still comes from a random mnemonic (identity.ts), but the user
 * never sees it. Instead the mnemonic is sealed inside a vault: a passphrase is
 * stretched with scrypt into a key, and that key encrypts the mnemonic with
 * AES-GCM. Only the sealed blob is ever stored - on the device, and optionally
 * on the server for signing in elsewhere. The server can never open it, because
 * it never has the passphrase.
 *
 * scrypt is memory-hard, so a stolen vault cannot be brute-forced cheaply, and
 * it ships inside @noble/hashes already - no new dependency. Getting the
 * passphrase wrong makes the AES-GCM open fail, which is exactly the "wrong
 * passphrase" signal the UI needs.
 */

import { scrypt } from '@noble/hashes/scrypt.js';
import { seal, open } from './aead.ts';
import { randomBytes, utf8ToBytes, bytesToUtf8 } from './bytes.ts';

/**
 * scrypt cost. N=2^16 is ~200ms on a laptop - deliberately slow, to blunt
 * offline guessing, while staying bearable for one unlock. Bump N, never lower
 * it, if devices get faster.
 */
const SCRYPT_PARAMS = { N: 2 ** 16, r: 8, p: 1, dkLen: 32 } as const;
const SALT_LENGTH = 16;

/** Binds the ciphertext to this construction, so a blob can't be repurposed. */
const VAULT_AAD = utf8ToBytes('copse-vault-v1');

/** A sealed vault. Every field is safe to store or send; none reveals the key. */
export interface Vault {
  /** Per-vault scrypt salt, so identical passphrases yield different keys. */
  readonly salt: Uint8Array;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** Stretch a passphrase into a 32-byte key. NFKC-normalised so the same typed
 * passphrase derives the same key on every platform. */
function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(utf8ToBytes(passphrase.normalize('NFKC')), salt, SCRYPT_PARAMS);
}

/** Seal arbitrary secret bytes under a passphrase. */
export async function sealVault(passphrase: string, secret: Uint8Array): Promise<Vault> {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const sealed = await seal(key, secret, VAULT_AAD);
  return { salt, iv: sealed.iv, ciphertext: sealed.ciphertext };
}

/** Open a vault. Throws on the wrong passphrase or a tampered blob. */
export async function openVault(passphrase: string, vault: Vault): Promise<Uint8Array> {
  const key = deriveKey(passphrase, vault.salt);
  return open(key, { iv: vault.iv, ciphertext: vault.ciphertext }, VAULT_AAD);
}

/** Seal a recovery mnemonic - the common case, the account's whole secret. */
export function sealMnemonic(passphrase: string, mnemonic: string): Promise<Vault> {
  return sealVault(passphrase, utf8ToBytes(mnemonic));
}

/** Recover a mnemonic from its vault. Throws if the passphrase is wrong. */
export async function openMnemonic(passphrase: string, vault: Vault): Promise<string> {
  return bytesToUtf8(await openVault(passphrase, vault));
}
