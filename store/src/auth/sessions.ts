/**
 * Sessions (WS10-R1).
 *
 * The browser holds one opaque cookie and nothing else: no token, no claims,
 * no key material. A scripting bug on the page therefore cannot steal
 * anything reusable, and the store can end a session at any moment by
 * forgetting it.
 *
 * Signing in establishes identity only. It grants no access to document
 * content: that still requires a device to be approved, or the recovery code,
 * or an administrator (WS7-R11 to R13).
 */
import { randomBytes } from 'crypto';
import type { Identity, JoinEvidenceRecord, PendingLogin } from './providers.ts';

export const SESSION_COOKIE = 'sd_session';

export interface Session {
  id: string;
  issuer: string;
  subject: string;
  /** The directory record behind (issuer, subject), resolved once at
   * sign-in rather than on every request. */
  userId?: string;
  displayName?: string;
  createdAt: number;
  expiresAt: number;
  /** WS14-R6: the groups the sign-in's ID token carried. */
  groups?: string[];
  groupsOverage?: boolean;
  /** WS14-R4: the raw token and its commitment, for a sign-in that made one.
   * Never sent back to the browser that owns the session (WS14-R45). */
  evidence?: JoinEvidenceRecord;
}

/**
 * Asynchronous throughout, so a session can live in PostgreSQL: sessions
 * kept only in a process are lost on every restart, and are invisible to a
 * second instance behind a load balancer.
 */
export interface SessionStore {
  create(identity: Identity): Promise<Session>;
  get(id: string | null): Promise<Session | null>;
  destroy(id: string): Promise<void>;
  /** Sign-ins that have started but not come back yet, by state. */
  remember(pending: PendingLogin): Promise<void>;
  take(state: string | null): Promise<PendingLogin | null>;
  /** Records the directory user behind a session, resolved at sign-in. */
  setUserId(id: string, userId: string): Promise<void>;
}

export interface SessionOptions {
  /** Default eight hours: long enough for a working day, short enough that a
   * forgotten session does not last indefinitely. */
  ttlMs?: number;
  /** A sign-in that never comes back is forgotten after this. */
  pendingTtlMs?: number;
  now?: () => number;
}

export function createSessionStore(options: SessionOptions = {}): SessionStore {
  const sessions = new Map<string, Session>();
  const pending = new Map<string, PendingLogin>();
  const ttl = options.ttlMs ?? 8 * 60 * 60 * 1000;
  const pendingTtl = options.pendingTtlMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now;

  function sweep() {
    const at = now();
    for (const [id, session] of sessions) if (session.expiresAt <= at) sessions.delete(id);
    for (const [state, login] of pending)
      if (login.createdAt + pendingTtl <= at) pending.delete(state);
  }

  return {
    async create(identity) {
      sweep();
      const session: Session = {
        // 256 bits from the platform CSPRNG: the cookie is the credential.
        id: randomBytes(32).toString('base64url'),
        issuer: identity.issuer,
        subject: identity.subject,
        displayName: identity.displayName,
        createdAt: now(),
        expiresAt: now() + ttl,
        ...(identity.groups ? { groups: [...identity.groups] } : {}),
        ...(identity.groupsOverage ? { groupsOverage: true } : {}),
        ...(identity.evidence ? { evidence: { ...identity.evidence } } : {}),
      };
      sessions.set(session.id, session);
      return session;
    },

    async get(id) {
      if (!id) return null;
      const session = sessions.get(id);
      if (!session) return null;
      if (session.expiresAt <= now()) {
        sessions.delete(id);
        return null;
      }
      return session;
    },

    async destroy(id) {
      sessions.delete(id);
    },

    async setUserId(id, userId) {
      const session = sessions.get(id);
      if (session) session.userId = userId;
    },

    async remember(login) {
      sweep();
      pending.set(login.state, login);
    },

    async take(state) {
      if (!state) return null;
      const login = pending.get(state);
      // Single use: a state that comes back twice is a replay.
      if (login) pending.delete(state);
      if (!login || login.createdAt + pendingTtl <= now()) return null;
      return login;
    },
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/**
 * HttpOnly, so page scripts cannot read it.
 *
 * SameSite depends on where the editor is served from. Same site as the
 * store: Lax, so another site cannot cause an authenticated request. A
 * different site - the usual deployment, editor and store on separate hosts
 * - has to be None, because a Lax cookie is not sent on cross-site requests
 * at all and every call would look unauthenticated. None requires Secure,
 * so a cross-origin deployment must be HTTPS; browsers treat localhost and
 * 127.0.0.1 as secure, which is what makes local development work.
 *
 * Dropping to None is safe here because the store allows only the origins
 * it was configured with (WS10-R1) and every state-changing route is a
 * POST/PUT/DELETE that a form cannot forge cross-origin without CORS.
 */
export function serializeSessionCookie(
  id: string,
  options: { secure: boolean; maxAgeSeconds: number; crossSite?: boolean },
): string {
  const crossSite = options.crossSite ?? false;
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${crossSite ? 'None' : 'Lax'}`,
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure || crossSite) parts.push('Secure');
  return parts.join('; ');
}

export function expiredSessionCookie(secure: boolean, crossSite = false): string {
  return serializeSessionCookie('', { secure, maxAgeSeconds: 0, crossSite });
}
