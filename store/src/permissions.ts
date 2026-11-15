/**
 * Who may do what in a workspace (pure).
 *
 * In the trusted store the server decides access. There are no keys to
 * hold: a request is allowed because the signed-in person has a role in the
 * workspace, and for no other reason. That makes this module the thing that
 * must not be wrong, so it has no I/O and no dependencies, every rule is one
 * line in a table, and permissions.verify.ts checks the whole table.
 *
 * A person's role in a workspace is the highest of:
 *
 *   - the role they were given individually,
 *   - the role of any identity-provider group they are in that the workspace
 *     maps to a role, and
 *   - `owner`, if they are a store administrator.
 *
 * "Highest" is deliberate. A role is a grant, never a restriction: adding
 * someone as a viewer does not take away the editor role their group gives
 * them. To restrict someone, remove them from the group.
 */

export type WorkspaceRole = 'viewer' | 'editor' | 'owner';

/** Lowest to highest. The order is the rule: a role may do everything the
 * roles before it may. */
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['viewer', 'editor', 'owner'];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === 'string' && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

/** The higher of two roles; null counts as no role at all. */
export function higherRole(a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null {
  if (a === null) return b;
  if (b === null) return a;
  return WORKSPACE_ROLES.indexOf(a) >= WORKSPACE_ROLES.indexOf(b) ? a : b;
}

/**
 * Everything a role can be asked for inside one workspace. Store-wide
 * actions (creating a workspace, purging, legal holds) are not here: they
 * are not granted by a workspace role - see `canCreateWorkspace` and
 * `ADMIN_ONLY_ACTIONS`.
 */
export type WorkspaceAction =
  /** See the workspace, its members and its documents' titles. */
  | 'workspace.read'
  /** Rename it; add, change and remove members and group mappings. */
  | 'workspace.manage'
  | 'document.read'
  /** Create a document, append to it, compact it, change its title. */
  | 'document.write'
  /** Soft-delete a document, and restore one that is still retained. */
  | 'document.delete';

/** The least role that may perform each action. */
export const MINIMUM_ROLE: Readonly<Record<WorkspaceAction, WorkspaceRole>> = {
  'workspace.read': 'viewer',
  'document.read': 'viewer',
  'document.write': 'editor',
  'document.delete': 'editor',
  'workspace.manage': 'owner',
};

/** Store-wide actions. Only a store administrator may perform them. */
export type AdminAction =
  /** Hide a workspace from its members, or bring it back. */
  | 'workspace.archive'
  /** Remove a deleted document before its retention ends. */
  | 'document.purge'
  | 'document.hold'
  /** List every workspace, including ones the administrator is not in. */
  | 'store.administer';

export const ADMIN_ONLY_ACTIONS: readonly AdminAction[] = [
  'workspace.archive',
  'document.purge',
  'document.hold',
  'store.administer',
];

/** Whether `role` is enough for `action`. No role is never enough. */
export function roleAllows(role: WorkspaceRole | null, action: WorkspaceAction): boolean {
  if (role === null) return false;
  return WORKSPACE_ROLES.indexOf(role) >= WORKSPACE_ROLES.indexOf(MINIMUM_ROLE[action]);
}

/** The signed-in person, as far as access is concerned. */
export interface Principal {
  userId: string;
  /** Identity-provider groups from their sign-in. Compared exactly: group
   * names are case-sensitive, as the provider issues them. */
  groups: readonly string[];
  isAdmin: boolean;
}

/** How a role was arrived at, for the interface ("through platform-eng")
 * and for the audit trail. */
export type RoleSource = { kind: 'member' } | { kind: 'group'; group: string } | { kind: 'admin' };

export interface EffectiveRole {
  role: WorkspaceRole;
  source: RoleSource;
}

export interface WorkspaceGrants {
  /** The role this person was given individually, if any. */
  memberRole: WorkspaceRole | null;
  /** The workspace's group mappings - all of them, not only this person's. */
  groupRoles: readonly { group: string; role: WorkspaceRole }[];
}

/**
 * The role `principal` has in a workspace with these grants, or null when
 * they have none.
 *
 * When two grants give the same role, the more specific one is reported:
 * individual membership, then a group (the first in name order, so the
 * answer does not depend on the order mappings were stored in), then
 * administrator.
 */
export function effectiveRole(principal: Principal, grants: WorkspaceGrants): EffectiveRole | null {
  let best: EffectiveRole | null = null;
  const consider = (candidate: EffectiveRole) => {
    if (best === null || higherRole(best.role, candidate.role) !== best.role) best = candidate;
  };

  if (grants.memberRole) consider({ role: grants.memberRole, source: { kind: 'member' } });

  const mine = new Set(principal.groups);
  const matching = grants.groupRoles
    .filter((mapping) => mine.has(mapping.group))
    .sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
  for (const mapping of matching) {
    consider({ role: mapping.role, source: { kind: 'group', group: mapping.group } });
  }

  if (principal.isAdmin) consider({ role: 'owner', source: { kind: 'admin' } });

  return best;
}

export interface WorkspaceState {
  /** Archived workspaces are hidden from everyone but administrators, and
   * nothing in them can be changed until they are restored. */
  archived: boolean;
}

/**
 * The single question a route handler asks: may this person do this here?
 *
 * In an archived workspace an administrator may still read (to decide
 * whether to restore it) and nobody may write.
 */
export function canInWorkspace(
  principal: Principal,
  grants: WorkspaceGrants,
  workspace: WorkspaceState,
  action: WorkspaceAction,
): boolean {
  const effective = effectiveRole(principal, grants);
  if (!effective) return false;
  if (workspace.archived) {
    const isRead = action === 'workspace.read' || action === 'document.read';
    return principal.isAdmin && isRead;
  }
  return roleAllows(effective.role, action);
}

export function canAdminister(principal: Principal, _action: AdminAction): boolean {
  return principal.isAdmin;
}

/** Who may create workspaces: a deployment's choice. */
export type WorkspaceCreationPolicy = 'admins' | 'anyone';

export function canCreateWorkspace(principal: Principal, policy: WorkspaceCreationPolicy): boolean {
  return principal.isAdmin || policy === 'anyone';
}

/**
 * Moving a document needs the right to remove it from one workspace and to
 * add it to the other. Without the first, an editor of any workspace could
 * take documents out of workspaces they can only read.
 */
export function canMoveDocument(
  principal: Principal,
  from: { grants: WorkspaceGrants; workspace: WorkspaceState },
  to: { grants: WorkspaceGrants; workspace: WorkspaceState },
): boolean {
  return (
    canInWorkspace(principal, from.grants, from.workspace, 'document.delete') &&
    canInWorkspace(principal, to.grants, to.workspace, 'document.write')
  );
}
