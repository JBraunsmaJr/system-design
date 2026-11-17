/**
 * Workspaces, members and group mappings in PostgreSQL. The same contract
 * as the in-memory store in workspaces.ts; scripts/verify-workspaces-
 * contract.ts runs one suite against both.
 *
 * Ordering is done here rather than in SQL: the database's collation and
 * JavaScript's string comparison disagree about case and punctuation, and
 * the two stores must return lists in the same order.
 */
import { randomUUID } from 'crypto';
import pg from 'pg';
import type { Principal, WorkspaceGrants, WorkspaceRole } from './permissions.ts';
import {
  WorkspaceError,
  accessibleFrom,
  byName,
  normalizeGroupName,
  normalizeWorkspaceName,
  requireRole,
  type GroupMapping,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceStore,
} from './workspaces.ts';

interface WorkspaceRow {
  workspace_id: string;
  name: string;
  created_by: string | null;
  created_at: Date;
  archived_at: Date | null;
}

interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  added_by: string | null;
  added_at: Date;
}

interface MappingRow {
  workspace_id: string;
  group_name: string;
  role: WorkspaceRole;
  added_by: string | null;
  added_at: Date;
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  workspaceId: row.workspace_id,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
});

const toMember = (row: MemberRow): WorkspaceMember => ({
  workspaceId: row.workspace_id,
  userId: row.user_id,
  role: row.role,
  addedBy: row.added_by,
  addedAt: row.added_at.toISOString(),
});

const toMapping = (row: MappingRow): GroupMapping => ({
  workspaceId: row.workspace_id,
  group: row.group_name,
  role: row.role,
  addedBy: row.added_by,
  addedAt: row.added_at.toISOString(),
});

const WORKSPACE_COLUMNS = 'workspace_id, name, created_by, created_at, archived_at';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function pgConstraint(error: unknown): string {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint: unknown }).constraint)
    : '';
}

export interface PostgresWorkspaceStoreOptions {
  now?: () => Date;
  newId?: () => string;
}

export function createPostgresWorkspaceStore(
  pool: pg.Pool,
  options: PostgresWorkspaceStoreOptions = {},
): WorkspaceStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `ws_${randomUUID()}`);

  /**
   * Turns the two constraint failures callers can cause into the errors the
   * contract names. A foreign key on a user column is "no such user"; on
   * the workspace column it is "no such workspace" - which can only happen
   * if the workspace is deleted between the check and the write.
   */
  function translate(error: unknown, context: { name?: string; userId?: string }): never {
    const code = pgCode(error);
    if (code === UNIQUE_VIOLATION && pgConstraint(error) === 'workspaces_name_idx') {
      throw new WorkspaceError(
        `There is already a workspace named "${context.name}".`,
        'name-taken',
      );
    }
    if (code === FOREIGN_KEY_VIOLATION) {
      const constraint = pgConstraint(error);
      if (constraint.includes('workspace_id')) {
        throw new WorkspaceError('That workspace no longer exists.', 'not-found');
      }
      throw new WorkspaceError(
        context.userId ? `No user ${context.userId}.` : 'That user does not exist.',
        'not-found',
      );
    }
    throw error;
  }

  async function existing(workspaceId: string): Promise<Workspace> {
    const result = await pool.query<WorkspaceRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE workspace_id = $1`,
      [workspaceId],
    );
    if (result.rowCount === 0) {
      throw new WorkspaceError(`No workspace ${workspaceId}.`, 'not-found');
    }
    return toWorkspace(result.rows[0]);
  }

  return {
    async createWorkspace({ name, createdBy }) {
      const normalized = normalizeWorkspaceName(name);
      const at = now();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const created = await client.query<WorkspaceRow>(
          `INSERT INTO workspaces (workspace_id, name, created_by, created_at)
           VALUES ($1, $2, $3, $4)
           RETURNING ${WORKSPACE_COLUMNS}`,
          [newId(), normalized, createdBy, at],
        );
        // The same transaction: a workspace never exists without an owner.
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, added_by, added_at)
           VALUES ($1, $2, 'owner', NULL, $3)`,
          [created.rows[0].workspace_id, createdBy, at],
        );
        await client.query('COMMIT');
        return toWorkspace(created.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return translate(error, { name: normalized, userId: createdBy });
      } finally {
        client.release();
      }
    },

    async getWorkspace(workspaceId) {
      const result = await pool.query<WorkspaceRow>(
        `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE workspace_id = $1`,
        [workspaceId],
      );
      return result.rowCount === 0 ? null : toWorkspace(result.rows[0]);
    },

    async listWorkspaces({ includeArchived = false } = {}) {
      const result = await pool.query<WorkspaceRow>(
        `SELECT ${WORKSPACE_COLUMNS} FROM workspaces
         WHERE $1 OR archived_at IS NULL`,
        [includeArchived],
      );
      return result.rows.map(toWorkspace).sort(byName);
    },

    async renameWorkspace(workspaceId, name) {
      await existing(workspaceId);
      const normalized = normalizeWorkspaceName(name);
      try {
        const result = await pool.query<WorkspaceRow>(
          `UPDATE workspaces SET name = $2 WHERE workspace_id = $1
           RETURNING ${WORKSPACE_COLUMNS}`,
          [workspaceId, normalized],
        );
        if (result.rowCount === 0) {
          throw new WorkspaceError(`No workspace ${workspaceId}.`, 'not-found');
        }
        return toWorkspace(result.rows[0]);
      } catch (error) {
        if (error instanceof WorkspaceError) throw error;
        return translate(error, { name: normalized });
      }
    },

    async setArchived(workspaceId, archived) {
      // COALESCE keeps the original time when archiving something that is
      // already archived.
      const result = await pool.query<WorkspaceRow>(
        `UPDATE workspaces
         SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, $3) ELSE NULL END
         WHERE workspace_id = $1
         RETURNING ${WORKSPACE_COLUMNS}`,
        [workspaceId, archived, now()],
      );
      if (result.rowCount === 0) {
        throw new WorkspaceError(`No workspace ${workspaceId}.`, 'not-found');
      }
      return toWorkspace(result.rows[0]);
    },

    async listMembers(workspaceId) {
      await existing(workspaceId);
      const result = await pool.query<MemberRow>(
        `SELECT workspace_id, user_id, role, added_by, added_at FROM workspace_members
         WHERE workspace_id = $1
         ORDER BY added_at, user_id`,
        [workspaceId],
      );
      return result.rows.map(toMember);
    },

    async putMember({ workspaceId, userId, role, addedBy }) {
      await existing(workspaceId);
      const checked = requireRole(role);
      try {
        // On a role change, who added them and when are left as they were.
        const result = await pool.query<MemberRow>(
          `INSERT INTO workspace_members (workspace_id, user_id, role, added_by, added_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
           RETURNING workspace_id, user_id, role, added_by, added_at`,
          [workspaceId, userId, checked, addedBy, now()],
        );
        return toMember(result.rows[0]);
      } catch (error) {
        return translate(error, { userId });
      }
    },

    async removeMember(workspaceId, userId) {
      await existing(workspaceId);
      const result = await pool.query(
        `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async listGroupMappings(workspaceId) {
      await existing(workspaceId);
      const result = await pool.query<MappingRow>(
        `SELECT workspace_id, group_name, role, added_by, added_at FROM workspace_group_roles
         WHERE workspace_id = $1`,
        [workspaceId],
      );
      return result.rows
        .map(toMapping)
        .sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
    },

    async putGroupMapping({ workspaceId, group, role, addedBy }) {
      await existing(workspaceId);
      const name = normalizeGroupName(group);
      const checked = requireRole(role);
      try {
        const result = await pool.query<MappingRow>(
          `INSERT INTO workspace_group_roles (workspace_id, group_name, role, added_by, added_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, group_name) DO UPDATE SET role = EXCLUDED.role
           RETURNING workspace_id, group_name, role, added_by, added_at`,
          [workspaceId, name, checked, addedBy, now()],
        );
        return toMapping(result.rows[0]);
      } catch (error) {
        return translate(error, {});
      }
    },

    async removeGroupMapping(workspaceId, group) {
      await existing(workspaceId);
      const result = await pool.query(
        `DELETE FROM workspace_group_roles WHERE workspace_id = $1 AND group_name = $2`,
        [workspaceId, normalizeGroupName(group)],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async grantsFor(workspaceId, userId) {
      // One round trip: this runs on every request that touches a workspace.
      const result = await pool.query<
        WorkspaceRow & {
          member_role: WorkspaceRole | null;
          group_roles: { group: string; role: WorkspaceRole }[];
        }
      >(
        `SELECT w.workspace_id, w.name, w.created_by, w.created_at, w.archived_at,
                m.role AS member_role,
                COALESCE(
                  (SELECT json_agg(json_build_object('group', g.group_name, 'role', g.role))
                   FROM workspace_group_roles g WHERE g.workspace_id = w.workspace_id),
                  '[]'::json
                ) AS group_roles
         FROM workspaces w
         LEFT JOIN workspace_members m
           ON m.workspace_id = w.workspace_id AND m.user_id = $2
         WHERE w.workspace_id = $1`,
        [workspaceId, userId],
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      const grants: WorkspaceGrants = { memberRole: row.member_role, groupRoles: row.group_roles };
      return { workspace: toWorkspace(row), grants };
    },

    async listAccessible(principal: Principal, listOptions) {
      // Only the mappings for this person's own groups are fetched; the
      // others cannot give them a role. The decision itself stays in
      // permissions.ts, through accessibleFrom.
      const result = await pool.query<
        WorkspaceRow & {
          member_role: WorkspaceRole | null;
          group_roles: { group: string; role: WorkspaceRole }[];
        }
      >(
        `SELECT w.workspace_id, w.name, w.created_by, w.created_at, w.archived_at,
                m.role AS member_role,
                COALESCE(
                  (SELECT json_agg(json_build_object('group', g.group_name, 'role', g.role))
                   FROM workspace_group_roles g
                   WHERE g.workspace_id = w.workspace_id AND g.group_name = ANY($2::text[])),
                  '[]'::json
                ) AS group_roles
         FROM workspaces w
         LEFT JOIN workspace_members m
           ON m.workspace_id = w.workspace_id AND m.user_id = $1`,
        [principal.userId, [...principal.groups]],
      );
      return accessibleFrom(
        principal,
        result.rows.map((row) => ({
          workspace: toWorkspace(row),
          grants: { memberRole: row.member_role, groupRoles: row.group_roles },
        })),
        listOptions,
      );
    },
  };
}
