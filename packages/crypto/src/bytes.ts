/**
 * Byte encoding helpers.
 *
 * Everything cryptographic works in Uint8Array; everything on the wire is a
 * string. These are the only two places that conversion happens, so the rest
 * of the package never touches base64 or hex by hand.
 *
 * base64 uses btoa/atob, which exist in both the browser and Bun, so this file
 * carries no Node Buffer dependency and runs unchanged on the client.
 */

export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes, randomBytes } from '@noble/hashes/utils.js';

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
