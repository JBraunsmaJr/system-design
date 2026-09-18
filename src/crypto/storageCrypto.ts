/**
 * The single seam every piece of stored data passes through (WS6-R1).
 *
 * `seal` and `open` are the only crypto the rest of the application performs:
 * no other module may call `crypto.subtle`, which eslint.config.js enforces.
 * Two implementations satisfy the same interface (WS6-R2):
 *
 * - `webcrypto` (default): AES-256-GCM, a fresh 96-bit IV per blob (WS6-R6),
 *   with the envelope header and the blob's context authenticated (WS6-R4).
 * - `passthrough`: the same envelope, algorithm `none`, body in the clear.
 *   For development and demonstration against a store that is meant to read
 *   content. It is not encryption, and a deployment running it must say so
 *   in the interface (WS6-R3). Context is checked but *not* authenticated -
 *   nothing here can detect a store that edits a passthrough blob.
 *
 * Scope: this protects data at the store boundary. Browser storage is
 * deliberately not encrypted (WS2-R8).
 */
import {
  ALG_AES_256_GCM,
  ALG_NONE,
  ENVELOPE_VERSION,
  EnvelopeError,
  IV_BYTES,
  KDF_NONE,
  assemble,
  authenticatedData,
  buildHeader,
  parseEnvelope,
  type BlobContext,
} from "./envelope.ts";
import { randomBytes } from "./random.ts";

export type CryptoMode = "webcrypto" | "passthrough";

export interface StorageCrypto {
  readonly mode: CryptoMode;
  /** Wraps `plaintext` for `context`. The key is ignored in passthrough. */
  seal(context: BlobContext, plaintext: Uint8Array, key: CryptoKey | null): Promise<Uint8Array>;
  /** The inverse. Fails if the blob was written for another context. */
  open(context: BlobContext, blob: Uint8Array, key: CryptoKey | null): Promise<Uint8Array>;
  /** A fresh AES-256-GCM key, for callers that need one (tests, key setup). */
  generateContentKey(): Promise<CryptoKey>;
}

export type OpenErrorReason = EnvelopeError["reason"] | "wrong-key-or-tampered" | "missing-key" | "mode-mismatch";

export class OpenError extends Error {
  reason: OpenErrorReason;

  constructor(message: string, reason: OpenErrorReason) {
    super(message);
    this.name = "OpenError";
    this.reason = reason;
  }
}

/** The one place `crypto.subtle` is reached for content (WS6-R1). */
const subtle = () => globalThis.crypto.subtle;

function randomIv(): Uint8Array {
  return randomBytes(IV_BYTES);
}

const NO_KDF = new Uint8Array(0);

/** WebCrypto wants buffers backed by a plain ArrayBuffer; a sliced view is
 * not one. Copies exactly the bytes in view. */
function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

export function createWebCryptoStorage(): StorageCrypto {
  const header = buildHeader({
    formatVersion: ENVELOPE_VERSION,
    algorithm: ALG_AES_256_GCM,
    kdf: KDF_NONE,
    kdfParams: NO_KDF,
  });

  return {
    mode: "webcrypto",

    async generateContentKey() {
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    },

    async seal(context, plaintext, key) {
      if (!key) throw new OpenError("Sealing requires a key in webcrypto mode.", "missing-key");
      const iv = randomIv();
      const aad = authenticatedData(header, context);
      const ciphertext = new Uint8Array(
        await subtle().encrypt({ name: "AES-GCM", iv: buffer(iv), additionalData: buffer(aad) }, key, buffer(plaintext)),
      );
      return assemble(header, iv, ciphertext);
    },

    async open(context, blob, key) {
      if (!key) throw new OpenError("Opening requires a key in webcrypto mode.", "missing-key");
      const parsed = parseEnvelope(blob);
      if (parsed.algorithm !== ALG_AES_256_GCM) {
        throw new OpenError(
          "This blob is not encrypted; it was written by a store running in passthrough mode.",
          "mode-mismatch",
        );
      }
      const aad = authenticatedData(parsed.header, context);
      try {
        const plaintext = await subtle().decrypt(
          { name: "AES-GCM", iv: buffer(parsed.iv), additionalData: buffer(aad) },
          key,
          buffer(parsed.body),
        );
        return new Uint8Array(plaintext);
      } catch {
        // AES-GCM reports one failure for every cause: the wrong key, a
        // modified blob, or a blob belonging to another document, field, or
        // version. Callers are told what is verifiable, not a guess.
        throw new OpenError(
          "Could not open this blob: the key is wrong, the data was modified, or it belongs to a different document, field, or version.",
          "wrong-key-or-tampered",
        );
      }
    },
  };
}

export function createPassthroughStorage(): StorageCrypto {
  const header = buildHeader({
    formatVersion: ENVELOPE_VERSION,
    algorithm: ALG_NONE,
    kdf: KDF_NONE,
    kdfParams: NO_KDF,
  });
  const zeroIv = new Uint8Array(IV_BYTES);

  return {
    mode: "passthrough",

    async generateContentKey() {
      // Still a real key: switching modes must not need different call sites.
      return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    },

    async seal(context, plaintext) {
      // Validates the context on the way in, so a caller that would fail in
      // webcrypto mode fails here too.
      authenticatedData(header, context);
      return assemble(header, zeroIv, plaintext);
    },

    async open(context, blob) {
      const parsed = parseEnvelope(blob);
      if (parsed.algorithm !== ALG_NONE) {
        throw new OpenError(
          "This blob is encrypted, but this deployment runs in passthrough mode and has no key for it.",
          "mode-mismatch",
        );
      }
      authenticatedData(parsed.header, context);
      return parsed.body;
    },
  };
}

export function createStorageCrypto(mode: CryptoMode = "webcrypto"): StorageCrypto {
  return mode === "passthrough" ? createPassthroughStorage() : createWebCryptoStorage();
}
