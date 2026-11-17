/**
 * What a change to a workspace's members or groups would do to the person
 * making it, and to the workspace (pure).
 *
 * The store allows an owner to demote or remove themselves, and to remove
 * the last owner - an administrator can always put things right. That makes
 * these the changes worth a sentence before they happen: they are easy to
 * make by accident and, for someone who is not an administrator, cannot be
 * undone by the person who made them.
 *
 * The role arithmetic mirrors store/src/permissions.ts: a role is the
 * highest of the individual role, the roles of mapped groups the person is
 * in, and owner for a store administrator.
 */
import type { TrustedGroupMapping, TrustedMember, WorkspaceRole } from './trustedStoreClient.ts';

const ORDER: readonly WorkspaceRole[] = ['viewer', 'editor', 'owner'];

const higher = (a: WorkspaceRole | null, b: WorkspaceRole | null): WorkspaceRole | null => {
  if (a === null) return b;
  if (b === null) return a;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
};

export type AccessChange =
  | { kind: 'member-role'; userId: string; role: WorkspaceRole }
  | { kind: 'member-remove'; userId: string }
  | { kind: 'group-role'; group: string; role: WorkspaceRole }
  | { kind: 'group-remove'; group: string };

export interface AccessState {
  members: readonly Pick<TrustedMember, 'userId' | 'role'>[];
  groups: readonly Pick<TrustedGroupMapping, 'group' | 'role'>[];
}

export interface AccessActor {
  userId: string;
  groups: readonly string[];
  isAdmin: boolean;
}

/** The members and groups as they would be after a change. */
export function applyAccessChange(state: AccessState, change: AccessChange): AccessState {
  switch (change.kind) {
    case 'member-role': {
      const known = state.members.some((m) => m.userId === change.userId);
      return {
        ...state,
        members: known
          ? state.members.map((m) => (m.userId === change.userId ? { ...m, role: change.role } : m))
          : [...state.members, { userId: change.userId, role: change.role }],
      };
    }
    case 'member-remove':
      return { ...state, members: state.members.filter((m) => m.userId !== change.userId) };
    case 'group-role': {
      const known = state.groups.some((g) => g.group === change.group);
      return {
        ...state,
        groups: known
          ? state.groups.map((g) => (g.group === change.group ? { ...g, role: change.role } : g))
          : [...state.groups, { group: change.group, role: change.role }],
      };
    }
    case 'group-remove':
      return { ...state, groups: state.groups.filter((g) => g.group !== change.group) };
  }
}

/** The role someone has in a workspace with these members and groups. */
export function roleIn(state: AccessState, actor: AccessActor): WorkspaceRole | null {
  if (actor.isAdmin) return 'owner';
  let role: WorkspaceRole | null =
    state.members.find((m) => m.userId === actor.userId)?.role ?? null;
  for (const mapping of state.groups) {
    if (actor.groups.includes(mapping.group)) role = higher(role, mapping.role);
  }
  return role;
}

/**
 * A sentence to confirm before making a change, or null when the change
 * needs none. The most serious consequence wins: losing access outranks
 * losing the ability to manage, which outranks leaving no owner.
 */
export function warningFor(
  state: AccessState,
  actor: AccessActor,
  change: AccessChange,
): string | null {
  const after = applyAccessChange(state, change);
  if (!actor.isAdmin) {
    const before = roleIn(state, actor);
    const mine = roleIn(after, actor);
    if (before !== null && mine === null) {
      return 'You will lose access to this workspace and its documents. Only an owner or a store administrator can add you back.';
    }
    if (before === 'owner' && mine !== 'owner') {
      return `You will become ${mine === 'editor' ? 'an editor' : 'a viewer'} and will no longer be able to manage this workspace. Only an owner or a store administrator can change that back.`;
    }
  }
  const hadOwner =
    state.members.some((m) => m.role === 'owner') || state.groups.some((g) => g.role === 'owner');
  const hasOwner =
    after.members.some((m) => m.role === 'owner') || after.groups.some((g) => g.role === 'owner');
  if (hadOwner && !hasOwner) {
    return 'This leaves the workspace with no owner. Only store administrators will be able to manage it.';
  }
  return null;
}
