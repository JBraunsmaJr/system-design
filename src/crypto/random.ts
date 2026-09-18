/**
 * Random bytes for key material (WS6-R1).
 *
 * The one place `crypto.getRandomValues` is called, so every secret in the
 * system comes from the platform CSPRNG and callers cannot reach for
 * `Math.random` or a seeded generator by accident. The lint rule in
 * eslint.config.js allows the call only inside src/crypto.
 */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Error(`randomBytes needs a positive length, got ${length}.`);
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Lowercase hex, for secrets that travel in URLs (share links). */
export function randomHex(byteLength: number): string {
  return Array.from(randomBytes(byteLength))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
