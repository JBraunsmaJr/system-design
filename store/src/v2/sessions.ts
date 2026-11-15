/**
 * A workspace document's live session.
 *
 * Saving goes through the store. A live session is the other half: the
 * people who have a document open see each other's cursors and changes as
 * they happen, browser to browser, through the relay. To be in one, a
 * browser needs the room's name and the key that encrypts what passes
 * through the relay.
 *
 * Where documents were encrypted, both came from the document's key, which
 * only members held. Here the store hands them out, to people who may edit
 * the document and to no one else: a peer in a session can send changes
 * straight to the others, so someone who may only read must not be in it.
 * Viewers follow along through the store instead.
 *
 * Both are derived from a secret kept with the document, so everyone is
 * given the same room without the store keeping any record of a session.
 */
import { createHash } from 'crypto';

/** Marks a room as a workspace document's, so the general "give me a token
 * for this room" route can refuse it: see `isDocumentRoom`. */
export const DOCUMENT_ROOM_PREFIX = 'wsdoc-';

export interface DocumentSession {
  room: string;
  key: string;
}

const derive = (purpose: string, secret: string) =>
  createHash('sha256').update(`system-design/v2-session/${purpose}:${secret}`).digest();

export function documentSession(secret: string): DocumentSession {
  return {
    // Half the digest: far beyond guessing, and short enough to read in a
    // relay's log.
    room: `${DOCUMENT_ROOM_PREFIX}${derive('room', secret).subarray(0, 16).toString('hex')}`,
    // A different derivation, so the room's name - which the relay and its
    // logs see - says nothing about the key.
    key: derive('key', secret).toString('base64url'),
  };
}

export function isDocumentRoom(room: string): boolean {
  return room.startsWith(DOCUMENT_ROOM_PREFIX);
}
