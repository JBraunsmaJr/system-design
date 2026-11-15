/**
 * Verification for accessChanges.ts: which membership changes warn first.
 * Run with: npx tsx src/collab/trusted/accessChanges.verify.ts
 */
import { applyAccessChange, roleIn, warningFor, type AccessState } from './accessChanges.ts';

let passed = 0;
let failed = 0;
function check(condition: boolean, name: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const state: AccessState = {
  members: [
    { userId: 'ada', role: 'owner' },
    { userId: 'ben', role: 'editor' },
  ],
  groups: [
    { group: 'platform', role: 'editor' },
    { group: 'leads', role: 'owner' },
  ],
};
const ada = { userId: 'ada', groups: [], isAdmin: false };
const lead = { userId: 'lea', groups: ['leads'], isAdmin: false };
const both = { userId: 'ada', groups: ['leads'], isAdmin: false };
const admin = { userId: 'root', groups: [], isAdmin: true };

console.log('\n=== Roles ===');
check(roleIn(state, ada) === 'owner', 'an individual role counts');
check(roleIn(state, lead) === 'owner', 'a group role counts');
check(
  roleIn(state, { userId: 'ben', groups: ['leads'], isAdmin: false }) === 'owner',
  'the higher of the two wins',
);
check(roleIn(state, { userId: 'zed', groups: ['other'], isAdmin: false }) === null, 'no role');
check(roleIn({ members: [], groups: [] }, admin) === 'owner', 'an administrator is an owner');

console.log('\n=== Applying a change ===');
check(
  applyAccessChange(state, { kind: 'member-role', userId: 'cy', role: 'viewer' }).members.length ===
    3,
  'a role for someone new adds them',
);
check(
  applyAccessChange(state, { kind: 'member-role', userId: 'ben', role: 'owner' }).members.find(
    (m) => m.userId === 'ben',
  )?.role === 'owner' && state.members[1].role === 'editor',
  'a role for a member changes it, without touching the original',
);
check(
  applyAccessChange(state, { kind: 'group-remove', group: 'leads' }).groups.length === 1,
  'removing a group',
);
check(
  applyAccessChange(state, { kind: 'group-role', group: 'new', role: 'viewer' }).groups.length ===
    3,
  'mapping a new group',
);

console.log('\n=== Warnings ===');
check(
  warningFor(state, ada, { kind: 'member-role', userId: 'ben', role: 'viewer' }) === null,
  "changing someone else's role needs no warning",
);
check(
  /lose access/.test(warningFor(state, ada, { kind: 'member-remove', userId: 'ada' }) ?? ''),
  'removing yourself, with no group to fall back on, warns of losing access',
);
check(
  /become an editor/.test(
    warningFor(state, ada, { kind: 'member-role', userId: 'ada', role: 'editor' }) ?? '',
  ),
  'demoting yourself warns, and says what you become',
);
check(
  warningFor(state, both, { kind: 'member-remove', userId: 'ada' }) === null,
  'removing yourself is quiet when a group still makes you an owner',
);
check(
  /become a viewer/.test(
    warningFor(state, lead, { kind: 'group-role', group: 'leads', role: 'viewer' }) ?? '',
  ),
  'demoting the group that makes you an owner warns',
);
check(
  /lose access/.test(warningFor(state, lead, { kind: 'group-remove', group: 'leads' }) ?? ''),
  'removing the group that is your only way in warns of losing access',
);
const oneOwner: AccessState = { members: [{ userId: 'ada', role: 'owner' }], groups: [] };
check(
  /no owner/.test(warningFor(oneOwner, admin, { kind: 'member-remove', userId: 'ada' }) ?? ''),
  'an administrator removing the last owner is told it leaves none',
);
check(
  warningFor(state, admin, { kind: 'member-remove', userId: 'ada' }) === null,
  'removing an owner is quiet while an owner group remains',
);
check(
  warningFor({ members: [], groups: [] }, admin, {
    kind: 'member-role',
    userId: 'cy',
    role: 'viewer',
  }) === null,
  'a workspace that already had no owner does not warn again',
);

console.log(`\nAccess changes: ${passed} passed`);
// The runner reads this line; the suite has no Node types to exit with.
if (failed > 0) console.error(`${failed} check(s) failed`);
