/**
 * Tokens that let someone into a session room (WS10-R6, R7).
 *
 * Without these, knowing a room name is the only thing standing between
 * anyone who can reach the relay and a session. Where a deployment turns
 * this on, the store - which already knows who someone is - issues a
 * short-lived token for one room, and the relay accepts nothing else.
 *
 * The relay is deliberately kept dumb: it holds a shared secret and checks
 * a signature. It has no database, no session store, and no way to ask the
 * store anything, so it stays a piece of infrastructure a team can run
 * anywhere rather than another service with state.
 *
 * A token names a room and a subject, and expires in minutes. It is not a
 * capability for the document: everything in the session is still
 * end-to-end encrypted with the key from the link (WS3-R1), which the
 * relay never sees.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export interface RoomTokenClaims {
  /** The room this token admits its holder to, and no other. */
  room: string;
  /** Who it was issued to, for the relay's log and nothing else. */
  subject: string;
  /** Seconds since the epoch. */
  exp: number;
  iat: number;
}

export class RoomTokenError extends Error {
  reason: 'malformed' | 'signature' | 'expired' | 'wrong-room';

  constructor(message: string, reason: RoomTokenError['reason']) {
    super(message);
    this.name = 'RoomTokenError';
    this.reason = reason;
  }
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Default ten minutes: long enough to join, short enough that a token
 * copied out of a log is useless by the time anyone reads it. */
export const DEFAULT_ROOM_TOKEN_TTL_MS = 10 * 60_000;

export function mintRoomToken(options: {
  room: string;
  subject: string;
  secret: string;
  ttlMs?: number;
  now?: () => number;
}): { token: string; expiresAt: number } {
  const now = options.now?.() ?? Date.now();
  const expiresAt = now + (options.ttlMs ?? DEFAULT_ROOM_TOKEN_TTL_MS);
  const claims: RoomTokenClaims = {
    room: options.room,
    subject: options.subject,
    exp: Math.floor(expiresAt / 1000),
    iat: Math.floor(now / 1000),
  };
  const payload = encode(claims);
  return { token: `${payload}.${sign(payload, options.secret)}`, expiresAt };
}

/**
 * Checks a token against the room it is being used for. Every failure is
 * named: a relay that cannot say why it refused someone is a relay nobody
 * can debug.
 */
export function verifyRoomToken(
  token: string,
  options: { room: string; secret: string; now?: () => number; clockSkewSeconds?: number },
): RoomTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 2) throw new RoomTokenError('That is not a room token.', 'malformed');
  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload, options.secret));
  const offered = Buffer.from(signature);
  // Constant time, so the relay does not leak the signature a byte at a
  // time to someone willing to try.
  if (expected.length !== offered.length || !timingSafeEqual(expected, offered)) {
    throw new RoomTokenError('This token was not issued by the store.', 'signature');
  }

  let claims: RoomTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RoomTokenClaims;
  } catch {
    throw new RoomTokenError('That is not a room token.', 'malformed');
  }

  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + (options.clockSkewSeconds ?? 30) < now) {
    throw new RoomTokenError('This token has expired. Ask for another.', 'expired');
  }
  if (claims.room !== options.room) {
    // One token, one room: otherwise a token for a room someone belongs in
    // would open every other room too.
    throw new RoomTokenError('This token is for a different room.', 'wrong-room');
  }
  return claims;
}
