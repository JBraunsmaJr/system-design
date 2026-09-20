/**
 * The live session behind a workspace document (WS3, WS8-R3).
 *
 * A workspace says where documents live; a session says who is in one
 * right now. Opening a workspace document should put someone in the room
 * with everyone else who has it open, without anyone passing a link
 * around - otherwise edits arrive with no indication of who made them,
 * which is worse than useful.
 *
 * The room name is derived from the document key, so:
 *
 *  - everyone holding the key computes the same room, with nothing to
 *    coordinate and nothing to share;
 *  - the relay sees a hash of a key it does not have, and cannot tell
 *    which document, workspace, or deployment a room belongs to (WS8-R3);
 *  - someone without the key cannot find the room even knowing the
 *    document's id.
 *
 * The session's own encryption uses the document key itself, so a peer
 * who cannot decrypt the document cannot read its traffic either.
 */
import { sha256 } from '../crypto/hash.ts';

/** Distinguishes this use of the key from any other hashing of it. */
const ROOM_CONTEXT = 'system-design/workspace-room/v1:';

export async function deriveWorkspaceRoom(documentKey: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(`${ROOM_CONTEXT}${documentKey}`));
  // Half the digest: still far beyond guessing, and short enough to read
  // in a log when someone is debugging a relay.
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
