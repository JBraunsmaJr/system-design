/**
 * Key material: derivation, wrapping, escrow, and recovery codes.
 *
 * The hierarchy (WS7-R3, WS7-R8), each layer wrapping the one above:
 *
 * ```
 *   document key   in the share link; the storage key derives from it
 *     wrapped by → workspace key      (AES-KW)
 *     wrapped by → recovery public key (RSA-OAEP, escrow, WS7-R4)
 *   workspace key
 *     wrapped by → each member's user public key   (RSA-OAEP)
 *   user private key
 *     wrapped by → each of that user's device public keys (RSA-OAEP)
 *     wrapped by → a key derived from the recovery code   (PBKDF2 → AES-KW)
 * ```
 *
 * Nothing here talks to a store or a browser; it is pure key handling, so it
 * can be tested on its own and reused by the offline recovery tool.
 * Parameters are fixed by WS6-R5.
 */
import { randomBytes } from "./random.ts";
import { createWebCryptoStorage } from "./storageCrypto.ts";
import type { BlobContext } from "./envelope.ts";

/** WS6-R5. */
export const PBKDF2_ITERATIONS = 600_000;
export const RSA_MODULUS_BITS = 3072;
/** Distinguishes the storage key from the document key it derives from
 * (WS7-R1). Versioned, so the derivation can change without ambiguity. */
export const STORAGE_KEY_INFO = "system-design/storage/v1";

const encoder = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Hex, as the share link carries it, to bytes. Any other string is used as
 * its UTF-8 bytes, so a legacy password-based link still derives a key. */
function secretBytes(documentKey: string): Uint8Array {
  const trimmed = documentKey.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const out = new Uint8Array(trimmed.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return encoder.encode(trimmed);
}

/**
 * The storage key for a document (WS7-R1): HKDF-SHA-256 over the document
 * key, with a fixed versioned `info`. Deterministic, so any participant
 * derives the same key from the same link, including links issued before
 * this existed (WS7-R2). It is never equal to the document key, and never to
 * the key y-webrtc derives for the wire from the same secret, because both
 * sides use different derivations.
 */
export async function deriveStorageKey(documentKey: string): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", buffer(secretBytes(documentKey)), "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(STORAGE_KEY_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    // Extractable, because the workspace key and the recovery key wrap it
    // (WS7-R3, WS7-R4) and WebCrypto can only wrap an extractable key.
    true,
    ["encrypt", "decrypt"],
  );
}

/** A workspace key: wraps document keys, never content (WS7-R3). */
export async function generateWorkspaceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-KW", length: 256 }, true, ["wrapKey", "unwrapKey"]);
}

/** A document key as raw bytes, for callers that mint one outside a link. */
export function generateDocumentKeyHex(): string {
  return Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * An RSA-OAEP-3072 keypair for wrapping (WS7-R8).
 *
 * `purpose` decides whether the private half can leave the browser:
 *
 * - `"device"`: non-extractable. A device key is the anchor of that browser's
 *   access and must never be copied anywhere.
 * - `"user"`: extractable, because the user key is itself wrapped to each of
 *   that user's devices and to their recovery code.
 * - `"recovery"`: extractable, because first-run setup exports the private
 *   half once to be kept offline (WS7-R5, WS7-R10). It must never be stored
 *   by the application or the store. Its private half only
 *   ever exists wrapped, or in memory after an unlock.
 */
export type KeyPairPurpose = "user" | "device" | "recovery";

export async function generateWrappingKeyPair(purpose: KeyPairPurpose = "device"): Promise<CryptoKeyPair> {
  return subtle().generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: RSA_MODULUS_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    purpose !== "device",
    ["wrapKey", "unwrapKey"],
  ) as Promise<CryptoKeyPair>;
}

/** Exports a recovery private key, once, at first-run setup (WS7-R10). */
export async function exportPrivateKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey("pkcs8", key));
}

/** Imports a recovery private key, for the offline recovery tool (WS7-R6). */
export async function importRecoveryPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("pkcs8", buffer(pkcs8), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey("spki", key));
}

export async function importPublicKey(spki: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("spki", buffer(spki), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["wrapKey"]);
}

/** Wraps a symmetric key under another symmetric key (AES-KW). */
export async function wrapKey(key: CryptoKey, under: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().wrapKey("raw", key, under, "AES-KW"));
}

export async function unwrapKey(
  wrapped: Uint8Array,
  under: CryptoKey,
  as: "AES-GCM" | "AES-KW",
): Promise<CryptoKey> {
  const usages: KeyUsage[] = as === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
  return subtle().unwrapKey("raw", buffer(wrapped), under, "AES-KW", { name: as, length: 256 }, true, usages);
}

/** Wraps a symmetric key to a public key: escrow (WS7-R4), the workspace key
 * for a member, or a user key for a device (WS7-R8). */
export async function wrapKeyForPublicKey(key: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().wrapKey("raw", key, publicKey, { name: "RSA-OAEP" }));
}

export async function unwrapKeyWithPrivateKey(
  wrapped: Uint8Array,
  privateKey: CryptoKey,
  as: "AES-GCM" | "AES-KW",
): Promise<CryptoKey> {
  const usages: KeyUsage[] = as === "AES-KW" ? ["wrapKey", "unwrapKey"] : ["encrypt", "decrypt"];
  return subtle().unwrapKey("raw", buffer(wrapped), privateKey, { name: "RSA-OAEP" }, { name: as, length: 256 }, true, usages);
}

/**
 * A wrapped private key: the key itself sealed with a one-off symmetric key,
 * and that symmetric key wrapped for the recipient.
 *
 * RSA can only wrap something smaller than its modulus, and an RSA private
 * key is several times that, so wrapping one directly is impossible. Sealing
 * it with a fresh AES key and wrapping only that key is the usual answer, and
 * it keeps the sealed body in the same envelope as everything else (WS6-R4).
 */
export interface WrappedPrivateKey {
  /** The one-off key, wrapped for the recipient. */
  keyWrap: Uint8Array;
  /** The private key, sealed under the one-off key. */
  body: Uint8Array;
}

/** Wraps a user's private key for one of their devices (WS7-R8). */
export async function wrapPrivateKeyForPublicKey(
  privateKey: CryptoKey,
  recipientPublicKey: CryptoKey,
  context: BlobContext,
): Promise<WrappedPrivateKey> {
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", privateKey));
  const transport = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return {
    keyWrap: await wrapKeyForPublicKey(transport, recipientPublicKey),
    body: await createWebCryptoStorage().seal(context, pkcs8, transport),
  };
}

export async function unwrapPrivateKeyWithPrivateKey(
  wrapped: WrappedPrivateKey,
  recipientPrivateKey: CryptoKey,
  context: BlobContext,
): Promise<CryptoKey> {
  const transport = await unwrapKeyWithPrivateKey(wrapped.keyWrap, recipientPrivateKey, "AES-GCM");
  const pkcs8 = await createWebCryptoStorage().open(context, wrapped.body, transport);
  return importPrivateKey(pkcs8);
}

/** Wraps a private key under a symmetric key: the recovery code's key
 * (WS7-R12). */
export async function sealPrivateKey(privateKey: CryptoKey, under: CryptoKey, context: BlobContext): Promise<Uint8Array> {
  const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", privateKey));
  return createWebCryptoStorage().seal(context, pkcs8, under);
}

export async function openPrivateKey(sealed: Uint8Array, under: CryptoKey, context: BlobContext): Promise<CryptoKey> {
  return importPrivateKey(await createWebCryptoStorage().open(context, sealed, under));
}

async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey(
    "pkcs8",
    buffer(pkcs8),
    { name: "RSA-OAEP", hash: "SHA-256" },
    // Extractable: an unwrapped user key is re-wrapped to the next device the
    // user enrolls. Device keys are never unwrapped - they are generated in
    // place and stay there.
    true,
    ["unwrapKey"],
  );
}

// ---------------------------------------------------------------------------
// Recovery code (WS7-R12)

/** Crockford's base32 alphabet: no I, L, O, or U, so a code cannot be
 * misread as another code. 128 bits is 26 symbols. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_SYMBOLS = 26;
const CHECKSUM_SYMBOLS = 2;
const GROUP_SIZE = 5;

/** Characters people type for the ones this alphabet does not use. */
const CONFUSABLE: Record<string, string> = { O: "0", I: "1", L: "1", U: "V" };

function symbolsFromBytes(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, CODE_SYMBOLS);
}

function bytesFromSymbols(symbols: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const symbol of symbols) {
    value = (value << 5) | ALPHABET.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out.slice(0, 16));
}

/**
 * Two symbols over the code, Fletcher-style, reduced modulo the alphabet
 * size. Every single wrong symbol changes the running sum, and every
 * transposed neighbouring pair changes the positional sum, which covers what
 * mistyping actually produces. (Reducing modulo 31 instead would let symbol 0
 * and symbol 31 collide.)
 */
function checksum(symbols: string): string {
  const modulus = ALPHABET.length;
  let a = 0;
  let b = 0;
  for (const symbol of symbols) {
    a = (a + ALPHABET.indexOf(symbol)) % modulus;
    b = (b + a) % modulus;
  }
  return ALPHABET[a] + ALPHABET[b];
}

function group(symbols: string): string {
  return (symbols.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g")) ?? []).join("-");
}

export interface RecoveryCode {
  /** As shown to the user: groups separated by hyphens. */
  display: string;
  /** The 128 bits it carries. */
  secret: Uint8Array;
}

/** A recovery code: 128 bits, with a checksum (WS7-R12). */
export function generateRecoveryCode(): RecoveryCode {
  const secret = randomBytes(16);
  const symbols = symbolsFromBytes(secret);
  return { display: group(symbols + checksum(symbols)), secret: bytesFromSymbols(symbols) };
}

export type RecoveryCodeProblem = "empty" | "length" | "charset" | "checksum";

/**
 * Accepts a typed code, ignoring case, spaces and hyphens, and mapping the
 * characters people substitute for this alphabet (O for 0, I or L for 1).
 * A mistyped code is reported as mistyped rather than attempted as an unlock.
 */
export function parseRecoveryCode(input: string): { ok: true; secret: Uint8Array } | { ok: false; problem: RecoveryCodeProblem } {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .split("")
    .map((c) => CONFUSABLE[c] ?? c)
    .join("");
  if (cleaned.length === 0) return { ok: false, problem: "empty" };
  if (cleaned.length !== CODE_SYMBOLS + CHECKSUM_SYMBOLS) return { ok: false, problem: "length" };
  if ([...cleaned].some((c) => !ALPHABET.includes(c))) return { ok: false, problem: "charset" };
  const symbols = cleaned.slice(0, CODE_SYMBOLS);
  if (cleaned.slice(CODE_SYMBOLS) !== checksum(symbols)) return { ok: false, problem: "checksum" };
  return { ok: true, secret: bytesFromSymbols(symbols) };
}

/**
 * The key a recovery code unlocks with (WS7-R12): PBKDF2-SHA-256 over its
 * 128 bits with a per-user random salt, stored beside the wrap.
 */
export async function deriveRecoveryKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", buffer(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buffer(salt), iterations: PBKDF2_ITERATIONS },
    material,
    // AES-GCM, not AES-KW: it seals the user's private key, whose length is
    // not a multiple of the 8 bytes AES-KW requires.
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function newRecoverySalt(): Uint8Array {
  return randomBytes(16);
}

// ---------------------------------------------------------------------------
// Device verification code (WS7-R11)

/**
 * The short code shown on both devices during approval, derived from the new
 * device's public key. Both sides compute it from what they hold, so a key
 * substituted in transit produces different codes.
 */
export async function deviceVerificationCode(devicePublicKeySpki: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", buffer(devicePublicKeySpki)));
  return group(symbolsFromBytes(digest).slice(0, 8));
}
