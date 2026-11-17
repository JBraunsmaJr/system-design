/**
 * Run with: npx tsx store/src/permissions.verify.ts
 *
 * The permission rules, checked exhaustively: every role against every
 * action, and every way a role can be arrived at. The expected answers are
 * written out here rather than computed, so a change to permissions.ts that
 * widens access fails this suite instead of quietly agreeing with itself.
 */
import {
  ADMIN_ONLY_ACTIONS,
  MINIMUM_ROLE,
  WORKSPACE_ROLES,
  canAdminister,
  canCreateWorkspace,
  canInWorkspace,
  canMoveDocument,
  effectiveRole,
  higherRole,
  isWorkspaceRole,
  roleAllows,
  type Principal,
  type WorkspaceAction,
  type WorkspaceGrants,
  type WorkspaceRole,
} from './permissions.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const person = (overrides: Partial<Principal> = {}): Principal => ({
  userId: 'u-1',
  groups: [],
  isAdmin: false,
  ...overrides,
});
const grants = (overrides: Partial<WorkspaceGrants> = {}): WorkspaceGrants => ({
  memberRole: null,
  groupRoles: [],
  ...overrides,
});
const OPEN = { archived: false };
const ARCHIVED = { archived: true };

console.log('=== The role table ===');
{
  // The whole table, by hand. `true` means the role may perform the action.
  const expected: Record<WorkspaceAction, Record<WorkspaceRole, boolean>> = {
    'workspace.read': { viewer: true, editor: true, owner: true },
    'document.read': { viewer: true, editor: true, owner: true },
    'document.write': { viewer: false, editor: true, owner: true },
    'document.delete': { viewer: false, editor: true, owner: true },
    'workspace.manage': { viewer: false, editor: false, owner: true },
  };
  const actions = Object.keys(expected) as WorkspaceAction[];
  assert(
    actions.length === Object.keys(MINIMUM_ROLE).length,
    'every action in permissions.ts has an expected row here',
  );
  for (const action of actions) {
    for (const role of WORKSPACE_ROLES) {
      assert(
        roleAllows(role, action) === expected[action][role],
        `${role} ${expected[action][role] ? 'may' : 'may not'} ${action}`,
      );
    }
    assert(!roleAllows(null, action), `no role may not ${action}`);
  }
  // A role never loses something a lower role has.
  for (const action of actions) {
    let allowedBelow = false;
    for (const role of WORKSPACE_ROLES) {
      const allowed = roleAllows(role, action);
      assert(!(allowedBelow && !allowed), `${role} keeps ${action} if a lower role has it`);
      allowedBelow = allowedBelow || allowed;
    }
  }
}

console.log('\n=== Roles ===');
{
  assert(WORKSPACE_ROLES.join(',') === 'viewer,editor,owner', 'roles run viewer, editor, owner');
  assert(isWorkspaceRole('editor') && !isWorkspaceRole('admin'), 'only the three names are roles');
  assert(!isWorkspaceRole('Owner') && !isWorkspaceRole(undefined), 'role names are exact');
  assert(higherRole('viewer', 'owner') === 'owner', 'owner is higher than viewer');
  assert(higherRole('editor', 'viewer') === 'editor', 'editor is higher than viewer');
  assert(higherRole(null, 'viewer') === 'viewer', 'any role is higher than none');
  assert(higherRole(null, null) === null, 'no role and no role is no role');
}

console.log('\n=== How a role is arrived at ===');
{
  assert(effectiveRole(person(), grants()) === null, 'no grants, no role');

  const direct = effectiveRole(person(), grants({ memberRole: 'editor' }));
  assert(
    direct?.role === 'editor' && direct.source.kind === 'member',
    'an individual grant gives its role',
  );

  const mappings = [
    { group: 'platform-eng', role: 'editor' as const },
    { group: 'arch-review', role: 'viewer' as const },
    { group: 'platform-leads', role: 'owner' as const },
  ];
  const viaGroup = effectiveRole(
    person({ groups: ['arch-review'] }),
    grants({ groupRoles: mappings }),
  );
  assert(
    viaGroup?.role === 'viewer' &&
      viaGroup.source.kind === 'group' &&
      viaGroup.source.group === 'arch-review',
    "a mapped group gives that group's role, and names the group",
  );
  assert(
    effectiveRole(person({ groups: ['finance'] }), grants({ groupRoles: mappings })) === null,
    'an unmapped group gives nothing',
  );
  assert(
    effectiveRole(person({ groups: ['Platform-Eng'] }), grants({ groupRoles: mappings })) === null,
    'group names are compared exactly, including case',
  );

  const twoGroups = effectiveRole(
    person({ groups: ['arch-review', 'platform-leads', 'platform-eng'] }),
    grants({ groupRoles: mappings }),
  );
  assert(
    twoGroups?.role === 'owner' &&
      twoGroups.source.kind === 'group' &&
      twoGroups.source.group === 'platform-leads',
    'in several mapped groups, the highest role wins',
  );

  const lowerDirect = effectiveRole(
    person({ groups: ['platform-eng'] }),
    grants({ memberRole: 'viewer', groupRoles: mappings }),
  );
  assert(
    lowerDirect?.role === 'editor' && lowerDirect.source.kind === 'group',
    "a lower individual role does not take away a group's higher one",
  );

  const tie = effectiveRole(
    person({ groups: ['platform-eng'] }),
    grants({ memberRole: 'editor', groupRoles: mappings }),
  );
  assert(tie?.source.kind === 'member', 'on a tie, the individual grant is the one reported');

  const sameRoleGroups = [
    { group: 'zeta', role: 'editor' as const },
    { group: 'alpha', role: 'editor' as const },
  ];
  const stable = effectiveRole(
    person({ groups: ['zeta', 'alpha'] }),
    grants({ groupRoles: sameRoleGroups }),
  );
  const stableReversed = effectiveRole(
    person({ groups: ['alpha', 'zeta'] }),
    grants({ groupRoles: [...sameRoleGroups].reverse() }),
  );
  assert(
    stable?.source.kind === 'group' &&
      stable.source.group === 'alpha' &&
      stableReversed?.source.kind === 'group' &&
      stableReversed.source.group === 'alpha',
    'between groups giving the same role, the report does not depend on stored order',
  );

  const admin = effectiveRole(person({ isAdmin: true }), grants());
  assert(
    admin?.role === 'owner' && admin.source.kind === 'admin',
    'an administrator is an owner of a workspace they were never added to',
  );
  const adminMember = effectiveRole(person({ isAdmin: true }), grants({ memberRole: 'viewer' }));
  assert(
    adminMember?.role === 'owner' && adminMember.source.kind === 'admin',
    'an administrator added as a viewer is still an owner',
  );
  const adminOwner = effectiveRole(person({ isAdmin: true }), grants({ memberRole: 'owner' }));
  assert(
    adminOwner?.source.kind === 'member',
    'an administrator who is also an individual owner is reported as a member',
  );
}

console.log('\n=== May this person do this here? ===');
{
  const stranger = person();
  const viewer = grants({ memberRole: 'viewer' });
  const editor = grants({ memberRole: 'editor' });
  const owner = grants({ memberRole: 'owner' });
  const everyAction = Object.keys(MINIMUM_ROLE) as WorkspaceAction[];

  for (const action of everyAction) {
    assert(
      !canInWorkspace(stranger, grants(), OPEN, action),
      `someone with no role may not ${action}`,
    );
  }
  assert(canInWorkspace(stranger, viewer, OPEN, 'document.read'), 'a viewer may read');
  assert(!canInWorkspace(stranger, viewer, OPEN, 'document.write'), 'a viewer may not write');
  assert(canInWorkspace(stranger, editor, OPEN, 'document.write'), 'an editor may write');
  assert(
    !canInWorkspace(stranger, editor, OPEN, 'workspace.manage'),
    'an editor may not manage members',
  );
  assert(canInWorkspace(stranger, owner, OPEN, 'workspace.manage'), 'an owner may manage members');

  // Archived: hidden from members, read-only for administrators.
  for (const action of everyAction) {
    assert(
      !canInWorkspace(stranger, owner, ARCHIVED, action),
      `an owner may not ${action} in an archived workspace`,
    );
  }
  const admin = person({ isAdmin: true });
  assert(
    canInWorkspace(admin, grants(), ARCHIVED, 'workspace.read') &&
      canInWorkspace(admin, grants(), ARCHIVED, 'document.read'),
    'an administrator may read an archived workspace',
  );
  for (const action of ['document.write', 'document.delete', 'workspace.manage'] as const) {
    assert(
      !canInWorkspace(admin, grants(), ARCHIVED, action),
      `an administrator may not ${action} in an archived workspace`,
    );
  }
  for (const action of everyAction) {
    assert(
      canInWorkspace(admin, grants(), OPEN, action),
      `an administrator may ${action} in any open workspace`,
    );
  }
}

console.log('\n=== Store-wide actions ===');
{
  const admin = person({ isAdmin: true });
  const owner = person();
  for (const action of ADMIN_ONLY_ACTIONS) {
    assert(canAdminister(admin, action), `an administrator may ${action}`);
    assert(!canAdminister(owner, action), `nobody else may ${action}`);
  }
  assert(ADMIN_ONLY_ACTIONS.length === 4, 'four store-wide actions');
  assert(canCreateWorkspace(admin, 'admins'), 'an administrator may always create a workspace');
  assert(
    !canCreateWorkspace(owner, 'admins'),
    'under the "admins" policy nobody else may create a workspace',
  );
  assert(canCreateWorkspace(owner, 'anyone'), 'under the "anyone" policy any signed-in person may');
}

console.log('\n=== Moving a document ===');
{
  const p = person();
  const as = (role: WorkspaceRole | null, archived = false) => ({
    grants: grants({ memberRole: role }),
    workspace: { archived },
  });
  assert(canMoveDocument(p, as('editor'), as('editor')), 'an editor of both may move');
  assert(
    !canMoveDocument(p, as('viewer'), as('editor')),
    'a viewer of the source may not move a document out of it',
  );
  assert(
    !canMoveDocument(p, as('editor'), as('viewer')),
    'a viewer of the destination may not move a document into it',
  );
  assert(!canMoveDocument(p, as('editor'), as(null)), 'nor into a workspace they are not in');
  assert(!canMoveDocument(p, as(null), as('owner')), 'nor out of one they are not in');
  assert(
    !canMoveDocument(p, as('owner'), as('owner', true)),
    'nothing moves into an archived workspace',
  );
  assert(
    !canMoveDocument(p, as('owner', true), as('owner')),
    'nothing moves out of an archived workspace',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
