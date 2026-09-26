/**
 * Automatic-access state in PostgreSQL (WS14). The same contract as the
 * in-memory store in access.ts; verify-store-join-requests.ts runs against
 * both.
 */
import pg from 'pg';
import {
  AccessError,
  type AccessStore,
  type JoinRequestRecord,
  type MembershipRecord,
  type RoutingRule,
} from './access.ts';

interface RuleRow {
  workspace_id: string;
  rule_version: number;
  enabled: boolean;
  claim: string;
  groups: string[];
  evidence_max_age_seconds: number;
  rotation_required: boolean;
  updated_at: Date;
}

interface RequestRow {
  workspace_id: string;
  user_id: string;
  id_token: string | null;
  evidence_hash: string;
  salt: string;
  public_key: string;
  iat: string; // BIGINT arrives as a string
  status: JoinRequestRecord['status'];
  last_rejection: string | null;
  last_rejection_at: Date | null;
  created_at: Date;
}

interface MembershipRow {
  workspace_id: string;
  user_id: string;
  source: MembershipRecord['source'];
  matched_group: string | null;
  granted_by: string | null;
  granted_at: Date;
  removed_at: Date | null;
}

const toRule = (row: RuleRow): RoutingRule => ({
  workspaceId: row.workspace_id,
  ruleVersion: row.rule_version,
  enabled: row.enabled,
  claim: row.claim,
  groups: row.groups,
  evidenceMaxAgeSeconds: row.evidence_max_age_seconds,
  rotationRequired: row.rotation_required,
  updatedAt: row.updated_at.toISOString(),
});

const toRequest = (row: RequestRow): JoinRequestRecord => ({
  workspaceId: row.workspace_id,
  userId: row.user_id,
  idToken: row.id_token,
  evidenceHash: row.evidence_hash,
  salt: row.salt,
  publicKey: row.public_key,
  iat: Number(row.iat),
  status: row.status,
  lastRejection: row.last_rejection,
  lastRejectionAt: row.last_rejection_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
});

const toMembership = (row: MembershipRow): MembershipRecord => ({
  workspaceId: row.workspace_id,
  userId: row.user_id,
  source: row.source,
  matchedGroup: row.matched_group,
  grantedBy: row.granted_by,
  grantedAt: row.granted_at.toISOString(),
  removedAt: row.removed_at?.toISOString() ?? null,
});

export function createPostgresAccessStore(pool: pg.Pool): AccessStore {
  return {
    async getRule(workspaceId) {
      const result = await pool.query<RuleRow>(
        `SELECT * FROM workspace_access_rules WHERE workspace_id = $1`,
        [workspaceId],
      );
      return result.rows[0] ? toRule(result.rows[0]) : null;
    },

    async listRules() {
      const result = await pool.query<RuleRow>(`SELECT * FROM workspace_access_rules`);
      return result.rows.map(toRule);
    },

    async putRule(rule) {
      // One statement, conditional on the version, so two writers racing
      // cannot both land and neither can move the version backwards.
      const result = await pool.query<RuleRow>(
        `INSERT INTO workspace_access_rules
           (workspace_id, rule_version, enabled, claim, groups, evidence_max_age_seconds, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (workspace_id) DO UPDATE SET
           rule_version = EXCLUDED.rule_version,
           enabled = EXCLUDED.enabled,
           claim = EXCLUDED.claim,
           groups = EXCLUDED.groups,
           evidence_max_age_seconds = EXCLUDED.evidence_max_age_seconds,
           updated_at = now()
         WHERE workspace_access_rules.rule_version < EXCLUDED.rule_version
         RETURNING *`,
        [
          rule.workspaceId,
          rule.ruleVersion,
          rule.enabled,
          rule.claim,
          rule.groups,
          rule.evidenceMaxAgeSeconds,
        ],
      );
      if (!result.rows[0]) {
        const current = await this.getRule(rule.workspaceId);
        throw new AccessError(
          `The store already holds rule version ${current?.ruleVersion ?? '?'}.`,
          'stale',
        );
      }
      return toRule(result.rows[0]);
    },

    async openRequest(request) {
      const result = await pool.query<RequestRow>(
        `INSERT INTO join_requests
           (workspace_id, user_id, id_token, evidence_hash, salt, public_key, iat, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now())
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET
           id_token = EXCLUDED.id_token,
           evidence_hash = EXCLUDED.evidence_hash,
           salt = EXCLUDED.salt,
           public_key = EXCLUDED.public_key,
           iat = EXCLUDED.iat,
           status = 'open',
           last_rejection = NULL,
           last_rejection_at = NULL,
           created_at = now()
         RETURNING *`,
        [
          request.workspaceId,
          request.userId,
          request.idToken,
          request.evidenceHash,
          request.salt,
          request.publicKey,
          request.iat,
        ],
      );
      return toRequest(result.rows[0]);
    },

    async getRequest(workspaceId, userId) {
      const result = await pool.query<RequestRow>(
        `SELECT * FROM join_requests WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      return result.rows[0] ? toRequest(result.rows[0]) : null;
    },

    async listRequests(workspaceId) {
      const result = await pool.query<RequestRow>(
        `SELECT * FROM join_requests WHERE workspace_id = $1 ORDER BY created_at`,
        [workspaceId],
      );
      return result.rows.map(toRequest);
    },

    async listRequestsForUser(userId) {
      const result = await pool.query<RequestRow>(
        `SELECT * FROM join_requests WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      );
      return result.rows.map(toRequest);
    },

    async closeRequest(workspaceId, userId, status) {
      await pool.query(
        `UPDATE join_requests SET status = $3, id_token = NULL
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId, status],
      );
    },

    async recordRejection(workspaceId, userId, reason) {
      const result = await pool.query(
        `UPDATE join_requests SET last_rejection = $3, last_rejection_at = now()
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId, reason],
      );
      if (result.rowCount === 0) throw new AccessError('No such join request.', 'not-found');
    },

    async expireEvidence(cutoff) {
      const result = await pool.query(
        `UPDATE join_requests
            SET id_token = NULL,
                status = CASE WHEN status = 'open' THEN 'expired' ELSE status END
          WHERE id_token IS NOT NULL AND iat < $1`,
        [Math.floor(cutoff.getTime() / 1000)],
      );
      return result.rowCount ?? 0;
    },

    async getMembership(workspaceId, userId) {
      const result = await pool.query<MembershipRow>(
        `SELECT * FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      return result.rows[0] ? toMembership(result.rows[0]) : null;
    },

    async putMembership(record) {
      const result = await pool.query<MembershipRow>(
        `INSERT INTO workspace_memberships (workspace_id, user_id, source, matched_group, granted_by, granted_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET
           source = EXCLUDED.source,
           matched_group = EXCLUDED.matched_group,
           granted_by = EXCLUDED.granted_by,
           granted_at = now(),
           removed_at = NULL
         RETURNING *`,
        [record.workspaceId, record.userId, record.source, record.matchedGroup, record.grantedBy],
      );
      return toMembership(result.rows[0]);
    },

    async setLastGroups(userId, groups) {
      await pool.query(
        `UPDATE users SET last_groups = $2, last_groups_at = now() WHERE user_id = $1`,
        [userId, groups],
      );
    },

    async getLastGroups(userId) {
      const result = await pool.query<{ last_groups: string[] | null }>(
        `SELECT last_groups FROM users WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0]?.last_groups ?? null;
    },
  };
}
