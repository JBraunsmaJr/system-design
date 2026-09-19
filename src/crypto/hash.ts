/**
 * Hashing, inside the crypto seam (WS6-R1).
 *
 * Not secret material, but it belongs here for the same reason everything
 * else does: one place decides the algorithm, and callers cannot reach for
 * `crypto.subtle` on their own.
 */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", view));
}

/** The document id for a session room (WS8-R3): the store learns a hash,
 * never the room name, so it cannot join the session it stores. */
export async function docIdForRoom(roomName: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(roomName));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
