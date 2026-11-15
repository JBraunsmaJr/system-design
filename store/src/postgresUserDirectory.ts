/**
 * The user directory in PostgreSQL. The same contract as the in-memory one
 * in userDirectory.ts; scripts/verify-workspaces-contract.ts runs one suite
 * against both.
 */
import { randomUUID } from 'crypto';
import pg from 'pg';
import { DirectoryError, type UserDirectory, type UserRecord } from './userDirectory.ts';

interface UserRow {
  user_id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
}

const toUser = (row: UserRow): UserRecord => ({
  userId: row.user_id,
  issuer: row.issuer,
  subject: row.subject,
  displayName: row.display_name ?? undefined,
});

const COLUMNS = 'user_id, issuer, subject, display_name';

export function createPostgresUserDirectory(pool: pg.Pool): UserDirectory {
  return {
    async upsertUser(identity): Promise<UserRecord> {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (user_id, issuer, subject, display_name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (issuer, subject) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, users.display_name)
         RETURNING ${COLUMNS}`,
        [randomUUID(), identity.issuer, identity.subject, identity.displayName ?? null],
      );
      return toUser(result.rows[0]);
    },

    async getUser(userId) {
      const result = await pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE user_id = $1`, [
        userId,
      ]);
      if (!result.rows[0]) throw new DirectoryError(`No user ${userId}.`, 'not-found');
      return toUser(result.rows[0]);
    },

    async listUsers() {
      // Ties broken by id, so the order is total.
      const result = await pool.query<UserRow>(
        `SELECT ${COLUMNS} FROM users ORDER BY created_at, user_id`,
      );
      return result.rows.map(toUser);
    },
  };
}
