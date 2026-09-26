/**
 * The versioned envelope every stored blob is wrapped in (WS6-R4).
 *
 * Layout, in order, matching the requirement:
 *
 * ```
 *   0  magic            4 bytes  "SDE\0"
 *   4  format version   1 byte   ENVELOPE_VERSION
 *   5  algorithm        1 byte   ALG_AES_256_GCM | ALG_NONE
 *   6  kdf              1 byte   KDF_NONE | KDF_HKDF_SHA256 | KDF_PBKDF2_SHA256
 *   7  kdf params len   2 bytes  big-endian
 *   9  kdf params       n bytes  empty when KDF_NONE
 *      iv               12 bytes (zero-filled when ALG_NONE)
 *      ciphertext       rest     GCM ciphertext with its tag, or plaintext
 * ```
 *
 * The header and the blob's context - document id, blob kind, document
 * version (WS8-R15) - are passed to AES-GCM as additional authenticated data.
 * They are not encrypted, and only the sealer knows them: decryption fails
 * unless the caller supplies the same ones. That is what stops a blob being
 * replayed as a different document, a different field, or an older version,
 * which encryption on its own does not prevent.
 *
 * Everything here is pure byte handling; no key material and no crypto calls.
 * The only module that may call `crypto.subtle` is storageCrypto.ts, which the
 * lint rule in eslint.config.js enforces.
 */

export const ENVELOPE_MAGIC = new Uint8Array([0x53, 0x44, 0x45, 0x00]); // "SDE\0"
export const ENVELOPE_VERSION = 1;
/** Versions this build can read. Older ones are re-sealed on the next write
 * (WS6-R4); anything absent here is rejected by name. Version 1 is the only
 * one so far, so nothing is re-sealed yet. */
export const KNOWN_ENVELOPE_VERSIONS: ReadonlySet<number> = new Set([1]);

export const ALG_NONE = 0;
export const ALG_AES_256_GCM = 1;

export const KDF_NONE = 0;
export const KDF_HKDF_SHA256 = 1;
export const KDF_PBKDF2_SHA256 = 2;

export const IV_BYTES = 12; // 96-bit, per WS6-R5
const HEADER_FIXED_BYTES = 9;

/** What a blob is, so one kind cannot be served in place of another. */
export type BlobKind =
  | 'update'
  | 'snapshot'
  | 'index'
  | 'key-wrap'
  | 'recovery-wrap'
  /** WS14-R8: a workspace's automatic access rule, sealed beside its index. */
  | 'access-rule'
  | 'test';

/**
 * The context a blob belongs to. Every field is authenticated, so all of them
 * must be supplied again - identically - to open it.
 */
export interface BlobContext {
  docId: string;
  kind: BlobKind;
  /** The document version this blob belongs to (WS8-R15). */
  version: number;
}

export interface EnvelopeHeader {
  formatVersion: number;
  algorithm: number;
  kdf: number;
  kdfParams: Uint8Array;
}

export interface ParsedEnvelope extends EnvelopeHeader {
  iv: Uint8Array;
  body: Uint8Array;
  /** The header bytes, which are part of the authenticated data. */
  header: Uint8Array;
}

/** Thrown for anything malformed, unknown, or truncated. */
export type EnvelopeErrorReason =
  | 'not-an-envelope'
  | 'unsupported-version'
  | 'unsupported-algorithm'
  | 'truncated'
  | 'invalid-context';

export class EnvelopeError extends Error {
  reason: EnvelopeErrorReason;

  constructor(message: string, reason: EnvelopeErrorReason) {
    super(message);
    this.name = 'EnvelopeError';
    this.reason = reason;
  }
}

const textEncoder = new TextEncoder();

function writeUint16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function buildHeader(header: EnvelopeHeader): Uint8Array {
  if (header.kdfParams.length > 0xffff)
    throw new EnvelopeError('KDF parameters are too long.', 'truncated');
  return concat([
    ENVELOPE_MAGIC,
    new Uint8Array([header.formatVersion, header.algorithm, header.kdf]),
    writeUint16(header.kdfParams.length),
    header.kdfParams,
  ]);
}

/**
 * The authenticated data for a blob: its header, then its context, each field
 * length-prefixed so that ("ab","c") and ("a","bc") cannot collide.
 */
export function authenticatedData(header: Uint8Array, context: BlobContext): Uint8Array {
  if (!context || typeof context.docId !== 'string' || context.docId.length === 0) {
    throw new EnvelopeError('A blob context needs a document id.', 'invalid-context');
  }
  if (typeof context.kind !== 'string' || context.kind.length === 0) {
    throw new EnvelopeError('A blob context needs a kind.', 'invalid-context');
  }
  if (!Number.isSafeInteger(context.version) || context.version < 0) {
    throw new EnvelopeError(
      'A blob context needs a non-negative integer version.',
      'invalid-context',
    );
  }
  const docId = textEncoder.encode(context.docId);
  const kind = textEncoder.encode(context.kind);
  const version = new Uint8Array(8);
  new DataView(version.buffer).setBigUint64(0, BigInt(context.version));
  return concat([
    header,
    writeUint16(docId.length),
    docId,
    writeUint16(kind.length),
    kind,
    version,
  ]);
}

export function assemble(header: Uint8Array, iv: Uint8Array, body: Uint8Array): Uint8Array {
  if (iv.length !== IV_BYTES)
    throw new EnvelopeError(`An IV must be ${IV_BYTES} bytes.`, 'truncated');
  return concat([header, iv, body]);
}

export function parseEnvelope(blob: Uint8Array): ParsedEnvelope {
  if (blob.length < HEADER_FIXED_BYTES + IV_BYTES) {
    throw new EnvelopeError('Too short to be an envelope.', 'truncated');
  }
  for (let i = 0; i < ENVELOPE_MAGIC.length; i++) {
    if (blob[i] !== ENVELOPE_MAGIC[i])
      throw new EnvelopeError('Not an envelope.', 'not-an-envelope');
  }
  const formatVersion = blob[4];
  if (!KNOWN_ENVELOPE_VERSIONS.has(formatVersion)) {
    throw new EnvelopeError(
      `Envelope format version ${formatVersion} is not supported by this build (expected ${ENVELOPE_VERSION}). A newer version wrote it.`,
      'unsupported-version',
    );
  }
  const algorithm = blob[5];
  if (algorithm !== ALG_AES_256_GCM && algorithm !== ALG_NONE) {
    throw new EnvelopeError(`Unknown envelope algorithm ${algorithm}.`, 'unsupported-algorithm');
  }
  const kdf = blob[6];
  const kdfLength = (blob[7] << 8) | blob[8];
  const kdfEnd = HEADER_FIXED_BYTES + kdfLength;
  const ivEnd = kdfEnd + IV_BYTES;
  if (blob.length < ivEnd) throw new EnvelopeError('Envelope is truncated.', 'truncated');
  return {
    formatVersion,
    algorithm,
    kdf,
    kdfParams: blob.slice(HEADER_FIXED_BYTES, kdfEnd),
    iv: blob.slice(kdfEnd, ivEnd),
    body: blob.slice(ivEnd),
    header: blob.slice(0, kdfEnd),
  };
}

/** Whether a blob predates the current envelope version and should be
 * re-sealed on its next write (WS6-R4). */
export function needsReseal(blob: Uint8Array): boolean {
  try {
    return parseEnvelope(blob).formatVersion < ENVELOPE_VERSION;
  } catch {
    // Unreadable, or written by a newer build: not something to re-seal.
    return false;
  }
}
