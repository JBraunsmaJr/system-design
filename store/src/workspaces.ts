/**
 * Workspaces, their members, and their group mappings.
 *
 * A workspace is a set of documents and the people who may use them. People
 * get in two ways: individually, or because an identity-provider group they
 * belong to is mapped to a role here. Group membership is read from the
 * sign-in and never stored per person, so someone added to a group has
 * access the next time they sign in, with nobody approving anything, and
 * someone removed from it loses access the same way.
 *
 * This module stores those facts and keeps them consistent. It does not
 * decide access - permissions.ts does, from what `grantsFor` returns - and
 * it does not check who is asking; the route handlers do that before they
 * call anything here.
 *
 * The in-memory store below and the PostgreSQL one in postgresWorkspaces.ts
 * have the same contract; scripts/verify-workspaces-contract.ts runs one
 * suite against both.
 */
import { randomUUID } from 'crypto';
import {
  effectiveRole,
  isWorkspaceRole,
  type EffectiveRole,
  type Principal,
  type WorkspaceGrants,
  type WorkspaceRole,
} from './permissions.ts';

export interface Workspace {
  workspaceId: string;
  name: string;
  /** Null once the creator's account is gone. */
  createdBy: string | null;
  createdAt: string;
  /** Hidden from members and read-only while set. */
  archivedAt: string | null;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** Null when the store added them itself (the creator of a workspace). */
  addedBy: string | null;
  addedAt: string;
}

export interface GroupMapping {
  workspaceId: string;
  /** The group exactly as the identity provider issues it. */
  group: string;
  role: WorkspaceRole;
  addedBy: string | null;
  addedAt: string;
}

/** A workspace together with one person's way into it. */
export interface WorkspaceAccess extends EffectiveRole {
  workspace: Workspace;
}

/** `not-found` covers a missing workspace and a missing user alike: the
 * message says which. */
export type WorkspaceErrorReason = 'not-found' | 'name-taken' | 'invalid';

export class WorkspaceError extends Error {
  reason: WorkspaceErrorReason;
  constructor(message: string, reason: WorkspaceErrorReason) {
    super(message);
    this.name = 'WorkspaceError';
    this.reason = reason;
  }
}

export const MAX_WORKSPACE_NAME_LENGTH = 120;
export const MAX_GROUP_NAME_LENGTH = 256;

/** A workspace name as stored: trimmed, with runs of whitespace collapsed. */
export function normalizeWorkspaceName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new WorkspaceError('A workspace needs a name.', 'invalid');
  }
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized === '') throw new WorkspaceError('A workspace needs a name.', 'invalid');
  if (normalized.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new WorkspaceError(
      `A workspace name can be at most ${MAX_WORKSPACE_NAME_LENGTH} characters.`,
      'invalid',
    );
  }
  return normalized;
}

/**
 * A group name as stored. Only surrounding whitespace is removed: the name
 * is matched exactly against the sign-in's groups, so its case and inner
 * spacing are the identity provider's to decide.
 */
export function normalizeGroupName(group: unknown): string {
  if (typeof group !== 'string' || group.trim() === '') {
    throw new WorkspaceError('A group mapping needs a group name.', 'invalid');
  }
  const normalized = group.trim();
  if (normalized.length > MAX_GROUP_NAME_LENGTH) {
    throw new WorkspaceError(
      `A group name can be at most ${MAX_GROUP_NAME_LENGTH} characters.`,
      'invalid',
    );
  }
  return normalized;
}

export function requireRole(role: unknown): WorkspaceRole {
  if (!isWorkspaceRole(role)) {
    throw new WorkspaceError('A role is one of viewer, editor or owner.', 'invalid');
  }
  return role;
}

export interface WorkspaceStore {
  /**
   * Creates a workspace and makes `createdBy` its first owner, together: a
   * workspace never exists without someone who can manage it. Names are
   * unique, ignoring case, so two workspaces cannot look the same in a list.
   */
  createWorkspace(input: { name: string; createdBy: string }): Promise<Workspace>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  /** In name order. Archived workspaces only when asked for. */
  listWorkspaces(options?: { includeArchived?: boolean }): Promise<Workspace[]>;
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  /** Archiving twice, or restoring one that is not archived, changes
   * nothing and is not an error. */
  setArchived(workspaceId: string, archived: boolean): Promise<Workspace>;

  /** In the order they were added; people added at the same instant are
   * in user-id order, so the order is total. */
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  /** Adds someone, or changes the role of someone already there. */
  putMember(input: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    addedBy: string | null;
  }): Promise<WorkspaceMember>;
  /** False when they were not an individual member. */
  removeMember(workspaceId: string, userId: string): Promise<boolean>;

  /** In group-name order. */
  listGroupMappings(workspaceId: string): Promise<GroupMapping[]>;
  /** Maps a group to a role, or changes the role of one already mapped. */
  putGroupMapping(input: {
    workspaceId: string;
    group: string;
    role: WorkspaceRole;
    addedBy: string | null;
  }): Promise<GroupMapping>;
  removeGroupMapping(workspaceId: string, group: string): Promise<boolean>;

  /**
   * What permissions.ts needs to decide one person's access to one
   * workspace, in one call. Null when the workspace does not exist.
   */
  grantsFor(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: Workspace; grants: WorkspaceGrants } | null>;

  /**
   * Every workspace this person has a role in, with that role, in name
   * order. Archived workspaces are left out unless asked for - and even
   * then only an administrator is given them, since they are hidden from
   * everyone else.
   */
  listAccessible(
    principal: Principal,
    options?: { includeArchived?: boolean },
  ): Promise<WorkspaceAccess[]>;
}

/** Name order as both stores use it: case-insensitive, then by id so the
 * order is total. */
export function byName(a: Workspace, b: Workspace): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0;
}

/**
 * Shared by both stores so the rule lives in one place: which of these
 * workspaces a person may see, and as what.
 */
export function accessibleFrom(
  principal: Principal,
  candidates: readonly { workspace: Workspace; grants: WorkspaceGrants }[],
  options: { includeArchived?: boolean } = {},
): WorkspaceAccess[] {
  const result: WorkspaceAccess[] = [];
  for (const { workspace, grants } of candidates) {
    if (workspace.archivedAt !== null && !(options.includeArchived && principal.isAdmin)) continue;
    const effective = effectiveRole(principal, grants);
    if (effective) result.push({ workspace, ...effective });
  }
  return result.sort((a, b) => byName(a.workspace, b.workspace));
}

export interface MemoryWorkspaceStoreOptions {
  now?: () => Date;
  newId?: () => string;
  /**
   * Whether a user id names a real user. PostgreSQL enforces this with a
   * foreign key; in memory it is this function, so both stores refuse an
   * unknown user the same way. Defaults to accepting any id.
   */
  userExists?: (userId: string) => boolean | Promise<boolean>;
}

/** For tests and for a store run without PostgreSQL. */
export function createMemoryWorkspaceStore(
  options: MemoryWorkspaceStoreOptions = {},
): WorkspaceStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => `ws_${randomUUID()}`);
  const workspaces = new Map<string, Workspace>();
  const members = new Map<string, Map<string, WorkspaceMember>>();
  const mappings = new Map<string, Map<string, GroupMapping>>();

  async function assertUser(userId: string) {
    if (options.userExists && !(await options.userExists(userId))) {
      throw new WorkspaceError(`No user ${userId}.`, 'not-found');
    }
  }

  function existing(workspaceId: string): Workspace {
    const workspace = workspaces.get(workspaceId);
    if (!workspace) throw new WorkspaceError(`No workspace ${workspaceId}.`, 'not-found');
    return workspace;
  }

  function assertNameFree(name: string, exceptId?: string) {
    const wanted = name.toLowerCase();
    for (const other of workspaces.values()) {
      if (other.workspaceId !== exceptId && other.name.toLowerCase() === wanted) {
        throw new WorkspaceError(
          `There is already a workspace named "${other.name}".`,
          'name-taken',
        );
      }
    }
  }

  function grantsOf(workspaceId: string, userId: string): WorkspaceGrants {
    return {
      memberRole: members.get(workspaceId)?.get(userId)?.role ?? null,
      groupRoles: [...(mappings.get(workspaceId)?.values() ?? [])].map(({ group, role }) => ({
        group,
        role,
      })),
    };
  }

  return {
    async createWorkspace({ name, createdBy }) {
      const normalized = normalizeWorkspaceName(name);
      await assertUser(createdBy);
      assertNameFree(normalized);
      const at = now().toISOString();
      const workspace: Workspace = {
        workspaceId: newId(),
        name: normalized,
        createdBy,
        createdAt: at,
        archivedAt: null,
      };
      workspaces.set(workspace.workspaceId, workspace);
      members.set(
        workspace.workspaceId,
        new Map([
          [
            createdBy,
            {
              workspaceId: workspace.workspaceId,
              userId: createdBy,
              role: 'owner',
              addedBy: null,
              addedAt: at,
            },
          ],
        ]),
      );
      mappings.set(workspace.workspaceId, new Map());
      return { ...workspace };
    },

    async getWorkspace(workspaceId) {
      const workspace = workspaces.get(workspaceId);
      return workspace ? { ...workspace } : null;
    },

    async listWorkspaces({ includeArchived = false } = {}) {
      return [...workspaces.values()]
        .filter((w) => includeArchived || w.archivedAt === null)
        .sort(byName)
        .map((w) => ({ ...w }));
    },

    async renameWorkspace(workspaceId, name) {
      const workspace = existing(workspaceId);
      const normalized = normalizeWorkspaceName(name);
      assertNameFree(normalized, workspaceId);
      workspace.name = normalized;
      return { ...workspace };
    },

    async setArchived(workspaceId, archived) {
      const workspace = existing(workspaceId);
      if (archived && workspace.archivedAt === null) workspace.archivedAt = now().toISOString();
      if (!archived) workspace.archivedAt = null;
      return { ...workspace };
    },

    async listMembers(workspaceId) {
      existing(workspaceId);
      return [...(members.get(workspaceId)?.values() ?? [])]
        .sort((a, b) =>
          a.addedAt !== b.addedAt
            ? a.addedAt < b.addedAt
              ? -1
              : 1
            : a.userId < b.userId
              ? -1
              : a.userId > b.userId
                ? 1
                : 0,
        )
        .map((m) => ({ ...m }));
    },

    async putMember({ workspaceId, userId, role, addedBy }) {
      existing(workspaceId);
      const checked = requireRole(role);
      await assertUser(userId);
      const list = members.get(workspaceId)!;
      const current = list.get(userId);
      // Changing a role keeps who added them and when: the record says how
      // they got in, and that has not changed.
      const member: WorkspaceMember = current
        ? { ...current, role: checked }
        : { workspaceId, userId, role: checked, addedBy, addedAt: now().toISOString() };
      list.set(userId, member);
      return { ...member };
    },

    async removeMember(workspaceId, userId) {
      existing(workspaceId);
      return members.get(workspaceId)!.delete(userId);
    },

    async listGroupMappings(workspaceId) {
      existing(workspaceId);
      return [...(mappings.get(workspaceId)?.values() ?? [])]
        .sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0))
        .map((m) => ({ ...m }));
    },

    async putGroupMapping({ workspaceId, group, role, addedBy }) {
      existing(workspaceId);
      const name = normalizeGroupName(group);
      const checked = requireRole(role);
      const list = mappings.get(workspaceId)!;
      const current = list.get(name);
      const mapping: GroupMapping = current
        ? { ...current, role: checked }
        : { workspaceId, group: name, role: checked, addedBy, addedAt: now().toISOString() };
      list.set(name, mapping);
      return { ...mapping };
    },

    async removeGroupMapping(workspaceId, group) {
      existing(workspaceId);
      return mappings.get(workspaceId)!.delete(normalizeGroupName(group));
    },

    async grantsFor(workspaceId, userId) {
      const workspace = workspaces.get(workspaceId);
      if (!workspace) return null;
      return { workspace: { ...workspace }, grants: grantsOf(workspaceId, userId) };
    },

    async listAccessible(principal, listOptions) {
      return accessibleFrom(
        principal,
        [...workspaces.values()].map((workspace) => ({
          workspace: { ...workspace },
          grants: grantsOf(workspace.workspaceId, principal.userId),
        })),
        listOptions,
      );
    },
  };
}
