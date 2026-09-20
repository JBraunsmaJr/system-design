/**
 * Sessions in PostgreSQL (WS10-R1).
 *
 * The same contract as the in-memory store, so one suite covers both. Why
 * it exists: sessions held in a process are lost on every restart and
 * invisible to a second instance, which makes a rolling deployment sign
 * everyone out and a pair of instances behave at random.
 *
 * Nothing here is a credential the browser holds - the cookie is an opaque
 * id - and expired rows are swept as they are touched, so a store left
 * running does not accumulate them.
 */
import { randomBytes } from 'crypto';
import pg from 'pg';
import type { Identity, PendingLogin } from './providers.ts';
import type { Session, SessionStore } from './sessions.ts';

export interface PostgresSessionOptions {
  ttlMs?: number;
  pendingTtlMs?: number;
  now?: () => number;
}

interface SessionRow {
  session_id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
}

export function createPostgresSessionStore(
  pool: pg.Pool,
  options: PostgresSessionOptions = {},
): SessionStore {
  const ttl = options.ttlMs ?? 8 * 60 * 60 * 1000;
  const pendingTtl = options.pendingTtlMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now;
  let lastSweep = 0;

  /** At most once a minute: expiry is enforced by the queries themselves,
   * so this only keeps the tables tidy. */
  async function sweep() {
    if (now() - lastSweep < 60_000) return;
    lastSweep = now();
    await pool.query(`DELETE FROM sessions WHERE expires_at <= now()`);
    await pool.query(
      `DELETE FROM pending_logins WHERE created_at <= now() - ($1::int * interval '1 millisecond')`,
      [pendingTtl],
    );
  }

  const toSession = (row: SessionRow): Session => ({
    id: row.session_id,
    issuer: row.issuer,
    subject: row.subject,
    displayName: row.display_name ?? undefined,
    userId: row.user_id ?? undefined,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
  });

  return {
    async create(identity: Identity) {
      await sweep();
      const id = randomBytes(32).toString('base64url');
      const result = await pool.query<SessionRow>(
        `INSERT INTO sessions (session_id, issuer, subject, display_name, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id,
          identity.issuer,
          identity.subject,
          identity.displayName ?? null,
          new Date(now()),
          new Date(now() + ttl),
        ],
      );
      return toSession(result.rows[0]);
    },

    async get(id) {
      if (!id) return null;
      // Expiry is part of the query: a session cannot outlive it even if
      // the sweep has not run.
      const result = await pool.query<SessionRow>(
        `SELECT * FROM sessions WHERE session_id = $1 AND expires_at > now()`,
        [id],
      );
      return result.rows[0] ? toSession(result.rows[0]) : null;
    },

    async destroy(id) {
      await pool.query(`DELETE FROM sessions WHERE session_id = $1`, [id]);
    },

    async setUserId(id, userId) {
      await pool.query(`UPDATE sessions SET user_id = $2 WHERE session_id = $1`, [id, userId]);
    },

    async remember(login: PendingLogin) {
      await sweep();
      await pool.query(
        `INSERT INTO pending_logins (state, provider, nonce, code_verifier, redirect_uri, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          login.state,
          login.provider,
          login.nonce,
          login.codeVerifier,
          login.redirectUri,
          new Date(login.createdAt),
        ],
      );
    },

    async take(state) {
      if (!state) return null;
      // Deleted as it is read, in one statement: two callbacks racing on
      // the same state cannot both succeed.
      const result = await pool.query<{
        provider: string;
        nonce: string;
        code_verifier: string;
        redirect_uri: string;
        created_at: Date;
      }>(
        `DELETE FROM pending_logins WHERE state = $1
           AND created_at > now() - ($2::int * interval '1 millisecond')
         RETURNING provider, nonce, code_verifier, redirect_uri, created_at`,
        [state, pendingTtl],
      );
      const row = result.rows[0];
      return row
        ? {
            state,
            provider: row.provider,
            nonce: row.nonce,
            codeVerifier: row.code_verifier,
            redirectUri: row.redirect_uri,
            createdAt: row.created_at.getTime(),
          }
        : null;
    },
  };
}
