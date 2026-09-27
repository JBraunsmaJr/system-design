/**
 * The join commitment (WS14-R1).
 *
 * Before signing in, a newcomer's browser commits to the public user key it
 * is about to publish, and that commitment travels as the OIDC `nonce`. The
 * identity provider copies the nonce into the ID token it signs, so the token
 * ends up vouching for three things together: this subject, in these groups,
 * holds this key.
 *
 * Without the key in the nonce, a store could pair a real person's genuine
 * token with a public key of its own, and a member's browser checking only
 * the token would hand the workspace key to the store. That is the attack
 * this binding exists to close (WS14 §4).
 *
 *   commitment = base64url( SHA-256( TAG ‖ 0x00 ‖ SPKI ‖ salt ) )
 *
 * The salt is 32 random bytes the browser keeps and later discloses with its
 * join request; it makes each sign-in's nonce unique even when the key is
 * not, so a nonce is never replayable across sign-ins.
 *
 * Used unchanged by the editor (to make the commitment, and as a granter to
 * check it) and by the store (to reject a mismatched request early, WS14-R14).
 * Only WebCrypto, so it runs in both.
 */
import { sha256 } from './hash.ts';

export const JOIN_COMMITMENT_TAG = 'system-design/join/v1';
export const JOIN_SALT_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
export const JOIN_COMMITMENT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newJoinSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(JOIN_SALT_BYTES));
}

/**
 * The commitment for one public key and one salt. `spki` must be exactly the
 * bytes that are published and later wrapped to (WS14-R22): hashing one
 * encoding and wrapping to another would verify a key nobody uses.
 */
export async function joinCommitment(spki: Uint8Array, salt: Uint8Array): Promise<string> {
  if (spki.length === 0) throw new Error('The public key is empty.');
  if (salt.length !== JOIN_SALT_BYTES)
    throw new Error(`The join salt must be ${JOIN_SALT_BYTES} bytes, not ${salt.length}.`);
  const tag = new TextEncoder().encode(JOIN_COMMITMENT_TAG);
  const input = new Uint8Array(tag.length + 1 + spki.length + salt.length);
  input.set(tag, 0);
  input[tag.length] = 0x00;
  input.set(spki, tag.length + 1);
  input.set(salt, tag.length + 1 + spki.length);
  return toBase64Url(await sha256(input));
}

/**
 * Whether a nonce is the commitment for this key and salt. Compared in
 * constant time: the nonce is not secret, but there is no reason to leak how
 * much of it matched.
 */
export async function matchesJoinCommitment(
  nonce: unknown,
  spki: Uint8Array,
  salt: Uint8Array,
): Promise<boolean> {
  if (typeof nonce !== 'string' || !JOIN_COMMITMENT_PATTERN.test(nonce)) return false;
  let expected: string;
  try {
    expected = await joinCommitment(spki, salt);
  } catch {
    return false;
  }
  let difference = nonce.length ^ expected.length;
  for (let i = 0; i < expected.length; i++)
    difference |= nonce.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
