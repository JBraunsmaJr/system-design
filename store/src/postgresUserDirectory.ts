/**
 * The PostgreSQL user directory (WS7-R8, R11, R12, R14).
 *
 * The same contract as the in-memory one, so scripts/verify-store-devices.ts
 * covers both. Every key column holds a wrap; the store can use none of them.
 */
import { randomUUID } from 'crypto';
import pg from 'pg';
import {
  DirectoryError,
  verificationCodeFor,
  type DeviceRecord,
  type RecoveryRecord,
  type UserDirectory,
  type UserRecord,
  type WrappedUserKey,
} from './userDirectory.ts';

interface UserRow {
  user_id: string;
  issuer: string;
  subject: string;
  display_name: string | null;
  user_public_key: Buffer | null;
}

const toUser = (row: UserRow): UserRecord => ({
  userId: row.user_id,
  issuer: row.issuer,
  subject: row.subject,
  displayName: row.display_name ?? undefined,
  publicKey: row.user_public_key ? row.user_public_key.toString('base64') : undefined,
});

interface DeviceRow {
  device_id: string;
  user_id: string;
  label: string | null;
  public_key: Buffer;
  wrapped_user_key_body: Buffer | null;
  wrapped_user_key_wrap: Buffer | null;
  created_at: Date;
  approved_at: Date | null;
  revoked_at: Date | null;
}

export function createPostgresUserDirectory(
  pool: pg.Pool,
  now: () => Date = () => new Date(),
): UserDirectory {
  const toDevice = async (row: DeviceRow): Promise<DeviceRecord> => ({
    deviceId: row.device_id,
    userId: row.user_id,
    label: row.label ?? undefined,
    publicKey: row.public_key.toString('base64'),
    verificationCode: await verificationCodeFor(row.public_key.toString('base64')),
    createdAt: row.created_at.toISOString(),
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    wrappedUserKey:
      row.wrapped_user_key_body && row.wrapped_user_key_wrap
        ? {
            body: row.wrapped_user_key_body.toString('base64'),
            keyWrap: row.wrapped_user_key_wrap.toString('base64'),
          }
        : null,
  });

  async function requireRow(userId: string, deviceId: string): Promise<DeviceRow> {
    const result = await pool.query<DeviceRow>(
      `SELECT * FROM devices WHERE device_id = $1 AND user_id = $2`,
      [deviceId, userId],
    );
    if (!result.rows[0]) throw new DirectoryError(`No device ${deviceId}.`, 'not-found');
    return result.rows[0];
  }

  return {
    async upsertUser(identity): Promise<UserRecord> {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (user_id, issuer, subject, display_name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (issuer, subject) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, users.display_name)
         RETURNING user_id, issuer, subject, display_name, user_public_key`,
        [randomUUID(), identity.issuer, identity.subject, identity.displayName ?? null],
      );
      return toUser(result.rows[0]);
    },

    async setUserPublicKey(userId, publicKey) {
      const result = await pool.query<UserRow>(
        `UPDATE users SET user_public_key = $2 WHERE user_id = $1
         RETURNING user_id, issuer, subject, display_name, user_public_key`,
        [userId, Buffer.from(publicKey, 'base64')],
      );
      if (!result.rows[0]) throw new DirectoryError(`No user ${userId}.`, 'not-found');
      return toUser(result.rows[0]);
    },

    async getUser(userId) {
      const result = await pool.query<UserRow>(
        `SELECT user_id, issuer, subject, display_name, user_public_key FROM users WHERE user_id = $1`,
        [userId],
      );
      if (!result.rows[0]) throw new DirectoryError(`No user ${userId}.`, 'not-found');
      return toUser(result.rows[0]);
    },

    async listUsers() {
      const result = await pool.query<UserRow>(
        `SELECT user_id, issuer, subject, display_name, user_public_key FROM users ORDER BY created_at`,
      );
      return result.rows.map(toUser);
    },

    async regrantUser(userId) {
      // Everything wrapped to the lost user key goes with it (WS7-R13).
      await pool.query(
        `UPDATE devices SET revoked_at = $2, wrapped_user_key_body = NULL, wrapped_user_key_wrap = NULL
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, now()],
      );
      await pool.query(`DELETE FROM user_recovery WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM workspace_keys WHERE user_id = $1`, [userId]);
      const result = await pool.query<UserRow>(
        `UPDATE users SET user_public_key = NULL WHERE user_id = $1
         RETURNING user_id, issuer, subject, display_name, user_public_key`,
        [userId],
      );
      if (!result.rows[0]) throw new DirectoryError(`No user ${userId}.`, 'not-found');
      return toUser(result.rows[0]);
    },

    async registerDevice(userId, device) {
      if (!device.publicKey)
        throw new DirectoryError('A device must register a public key.', 'bad-request');
      // The user's first device is approved as it registers - it generates
      // the user key - and every later one needs approval (WS7-R11).
      const existing = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM devices WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      const isFirst = Number(existing.rows[0].count) === 0;
      const at = now();
      const result = await pool.query<DeviceRow>(
        `INSERT INTO devices (device_id, user_id, label, public_key, created_at, approved_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          randomUUID(),
          userId,
          device.label ?? null,
          Buffer.from(device.publicKey, 'base64'),
          at,
          isFirst ? at : null,
        ],
      );
      return toDevice(result.rows[0]);
    },

    async listDevices(userId) {
      const result = await pool.query<DeviceRow>(
        `SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      return Promise.all(result.rows.map(toDevice));
    },

    async getDevice(userId, deviceId) {
      return toDevice(await requireRow(userId, deviceId));
    },

    async approveDevice(userId, deviceId, approvedBy, wrapped: WrappedUserKey) {
      const approver = await requireRow(userId, approvedBy);
      if (approver.revoked_at)
        throw new DirectoryError('A revoked device cannot approve another.', 'revoked');
      if (!approver.approved_at)
        throw new DirectoryError('Only an approved device can approve another.', 'not-approved');
      const device = await requireRow(userId, deviceId);
      if (device.revoked_at) throw new DirectoryError('That device has been revoked.', 'revoked');
      if (device.approved_at)
        throw new DirectoryError('That device is already approved.', 'conflict');
      const result = await pool.query<DeviceRow>(
        `UPDATE devices SET approved_at = $3, wrapped_user_key_body = $4, wrapped_user_key_wrap = $5
          WHERE device_id = $1 AND user_id = $2 RETURNING *`,
        [
          deviceId,
          userId,
          now(),
          Buffer.from(wrapped.body, 'base64'),
          Buffer.from(wrapped.keyWrap, 'base64'),
        ],
      );
      return toDevice(result.rows[0]);
    },

    async setOwnUserKey(userId, deviceId, wrapped) {
      const device = await requireRow(userId, deviceId);
      if (device.revoked_at) throw new DirectoryError('That device has been revoked.', 'revoked');
      if (!device.approved_at)
        throw new DirectoryError('That device is not approved.', 'not-approved');
      if (device.wrapped_user_key_body)
        throw new DirectoryError('That device already holds a wrapped user key.', 'conflict');
      const result = await pool.query<DeviceRow>(
        `UPDATE devices SET wrapped_user_key_body = $3, wrapped_user_key_wrap = $4 WHERE device_id = $1 AND user_id = $2 RETURNING *`,
        [
          deviceId,
          userId,
          Buffer.from(wrapped.body, 'base64'),
          Buffer.from(wrapped.keyWrap, 'base64'),
        ],
      );
      return toDevice(result.rows[0]);
    },

    async revokeDevice(userId, deviceId) {
      await requireRow(userId, deviceId);
      const result = await pool.query<DeviceRow>(
        // The wrap goes with the revocation (WS7-R14).
        `UPDATE devices SET revoked_at = $3, wrapped_user_key_body = NULL, wrapped_user_key_wrap = NULL
          WHERE device_id = $1 AND user_id = $2 RETURNING *`,
        [deviceId, userId, now()],
      );
      return toDevice(result.rows[0]);
    },

    async putRecovery(userId, recovery: RecoveryRecord) {
      await pool.query(
        `INSERT INTO user_recovery (user_id, salt, sealed_user_key, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET salt = EXCLUDED.salt, sealed_user_key = EXCLUDED.sealed_user_key, updated_at = EXCLUDED.updated_at`,
        [
          userId,
          Buffer.from(recovery.salt, 'base64'),
          Buffer.from(recovery.sealedUserKey, 'base64'),
          now(),
        ],
      );
    },

    async getRecovery(userId) {
      const result = await pool.query<{ salt: Buffer; sealed_user_key: Buffer }>(
        `SELECT salt, sealed_user_key FROM user_recovery WHERE user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      return row
        ? {
            salt: row.salt.toString('base64'),
            sealedUserKey: row.sealed_user_key.toString('base64'),
          }
        : null;
    },

    async putWorkspaceKey(userId, generation, wrappedKey) {
      await pool.query(
        `INSERT INTO workspace_keys (user_id, generation, wrapped_key) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, generation) DO UPDATE SET wrapped_key = EXCLUDED.wrapped_key`,
        [userId, generation, Buffer.from(wrappedKey, 'base64')],
      );
    },

    async getWorkspaceKeys(userId) {
      const result = await pool.query<{ generation: number; wrapped_key: Buffer }>(
        `SELECT generation, wrapped_key FROM workspace_keys WHERE user_id = $1 ORDER BY generation`,
        [userId],
      );
      return result.rows.map((row) => ({
        generation: row.generation,
        wrappedKey: row.wrapped_key.toString('base64'),
      }));
    },
  };
}
