/**
 * Checks for a requirement's priority, status, owner and target. Run with:
 *
 *   npx tsx src/domain/requirements/requirementAttributes.verify.ts
 */
import * as Y from 'yjs';
import {
  describeAttributes,
  getLifecycleMeta,
  getPriorityMeta,
  ownerMemberPatch,
  ownerNamePatch,
  resolveOwnerName,
} from './requirementAttributes.ts';
import { toMarkdownDocument } from './requirementsExport.ts';
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from './requirementsRegistry.ts';
import type { RequirementItem, RequirementsDocument } from './requirementsTypes.ts';
import {
  createYjsRequirementsStore,
  seedYjsRequirementsDoc,
} from '../../collab/stores/yjsRequirementsStore.ts';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error('FAIL:', msg);
    failures++;
  } else {
    console.log('ok:', msg);
  }
}

const members = new Map([['m-1', 'Ana Ruiz']]);
const milestones = new Map([['ms-1', 'Release 2.4']]);

console.log('=== Defaults ===');
assert(getLifecycleMeta(undefined).id === 'draft', 'no status reads as draft');
assert(getPriorityMeta(undefined) === undefined, 'no priority is no priority, not a default');
assert(getPriorityMeta('must')?.label === 'Must', 'a priority has a label');

console.log('\n=== Owner ===');
assert(resolveOwnerName({ ownerId: 'm-1' }, members) === 'Ana Ruiz', 'a team member by id');
assert(
  resolveOwnerName({ ownerName: 'Compliance' }, members) === 'Compliance',
  'someone else by name',
);
assert(resolveOwnerName({}, members) === undefined, 'no owner');
assert(
  resolveOwnerName({ ownerId: 'gone' }, members) === undefined,
  'a member since removed is no owner',
);
assert(resolveOwnerName({ ownerName: '   ' }, members) === undefined, 'a blank name is no owner');
{
  const member = ownerMemberPatch('m-1');
  assert(
    member.ownerId === 'm-1' && 'ownerName' in member && member.ownerName === undefined,
    'choosing a member clears a typed name',
  );
  const named = ownerNamePatch('  Compliance ');
  assert(
    named.ownerName === 'Compliance' && 'ownerId' in named && named.ownerId === undefined,
    'typing a name clears the member, and is trimmed',
  );
  assert(ownerNamePatch('  ').ownerName === undefined, 'a blank name clears the owner');
}

const full: RequirementItem = {
  id: 'REQ-1',
  typeId: 'requirement',
  title: 'Full',
  body: '',
  priority: 'must',
  lifecycle: 'approved',
  ownerId: 'm-1',
  targetMilestoneId: 'ms-1',
  verificationMethod: 'test',
  verificationStatus: 'failing',
  verificationNote: 'failed at 640 orders per second',
};
const bare: RequirementItem = { id: 'REQ-2', typeId: 'requirement', title: 'Bare', body: '' };
const doc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [],
  items: [full, bare, { id: 'TICKET-1', typeId: 'ticket', title: 'Work', body: '' }],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [],
  nextSequence: {},
};
const lookups = { memberNameById: members, milestoneNameById: milestones };

console.log('\n=== In one line ===');
assert(
  describeAttributes(full, lookups) === 'Must · Approved · Owner: Ana Ruiz · Target: Release 2.4',
  'everything that is set',
);
assert(describeAttributes(bare, lookups) === 'Draft', 'and only the status when nothing is');

console.log('\n=== Export ===');
{
  const md = toMarkdownDocument('T', doc, lookups);
  assert(
    md.includes('*Must · Approved · Owner: Ana Ruiz · Target: Release 2.4*'),
    'a requirement carries its attributes',
  );
  assert(
    md.includes('*Verification: Test - Failing (failed at 640 orders per second)*'),
    'and its verification note',
  );
  assert(!/TICKET-1[^#]*Draft/.test(md), 'a ticket carries neither');
  const noNames = toMarkdownDocument('T', doc);
  assert(
    noNames.includes('*Must · Approved*'),
    'without the names, an owner and target by id are left out',
  );
}

console.log('\n=== Collaborative store ===');
{
  const ydoc = new Y.Doc();
  seedYjsRequirementsDoc(ydoc, doc);
  const find = (d: Y.Doc, id: string) =>
    createYjsRequirementsStore(d)
      .getSnapshot()
      .items.find((i) => i.id === id);
  const seeded = find(ydoc, 'REQ-1');
  assert(
    seeded?.priority === 'must' &&
      seeded.lifecycle === 'approved' &&
      seeded.ownerId === 'm-1' &&
      seeded.targetMilestoneId === 'ms-1' &&
      seeded.verificationNote === full.verificationNote,
    'seeding from a file keeps every field',
  );
  const peerA = new Y.Doc();
  const peerB = new Y.Doc();
  Y.applyUpdate(peerA, Y.encodeStateAsUpdate(ydoc));
  Y.applyUpdate(peerB, Y.encodeStateAsUpdate(ydoc));
  createYjsRequirementsStore(peerA).updateItem('REQ-2', { priority: 'should' });
  createYjsRequirementsStore(peerB).updateItem('REQ-2', { lifecycle: 'in-review' });
  Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB));
  const merged = find(peerA, 'REQ-2');
  assert(
    merged?.priority === 'should' && merged.lifecycle === 'in-review',
    'a priority set by one person and a status by another both survive the merge',
  );
  createYjsRequirementsStore(peerA).updateItem('REQ-1', ownerNamePatch('Compliance'));
  const renamed = find(peerA, 'REQ-1');
  assert(
    renamed?.ownerName === 'Compliance' && renamed.ownerId === undefined,
    'changing the owner to a typed name clears the member',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
