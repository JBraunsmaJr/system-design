/**
 * Checks for verification and acceptance criteria. Run with:
 *
 *   npx tsx src/domain/requirements/verification.verify.ts
 */
import {
  describeVerification,
  getVerificationStatusMeta,
  isVerifiable,
  isVerified,
  parseAcceptanceCriteria,
} from './verification.ts';
import { computeCoverage } from './requirementsCoverage.ts';
import { itemHasGap, itemMatchesFilter, normalizeFilter } from './requirementsFilter.ts';
import { BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES } from './requirementsRegistry.ts';
import { toMarkdownDocument } from './requirementsExport.ts';
import type { RequirementItem, RequirementsDocument } from './requirementsTypes.ts';
import * as Y from 'yjs';
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

console.log('=== Acceptance criteria ===');
{
  const count = (body: string) => {
    const c = parseAcceptanceCriteria(body);
    return `${c.met}/${c.total}`;
  };
  assert(count('') === '0/0', 'an empty description has none');
  assert(
    count('Just prose.\n\n- a plain bullet') === '0/0',
    'prose and plain bullets are not criteria',
  );
  assert(
    count('- [ ] one\n- [x] two\n- [X] three') === '2/3',
    'task-list lines are, ticked or not',
  );
  assert(count('* [ ] star\n+ [x] plus\n1. [x] numbered') === '2/3', 'with any list marker');
  assert(count('Intro\n  - [x] indented\n    - [ ] nested') === '1/2', 'indented and nested too');
  assert(count('- [] no space\n- [y] not a tick\n- [ ]') === '0/0', 'a malformed box is not one');
  assert(
    count('- [x] real\n```\n- [ ] in a code block\n```\n- [ ] also real') === '1/2',
    'a line inside a fenced code block is text',
  );
  assert(count('- [x] a\r\n- [ ] b\r\n') === '1/2', 'Windows line endings are fine');
}

const items: RequirementItem[] = [
  {
    id: 'REQ-1',
    typeId: 'requirement',
    title: 'Verified with criteria',
    body: '- [x] holds',
    verificationMethod: 'test',
    verificationStatus: 'passing',
  },
  {
    id: 'REQ-2',
    typeId: 'requirement',
    title: 'Failing',
    body: '- [ ] a',
    verificationStatus: 'failing',
  },
  { id: 'CON-1', typeId: 'constraint', title: 'Nothing yet', body: 'Prose only.' },
  { id: 'GOAL-1', typeId: 'goal', title: 'A goal', body: '' },
  { id: 'ADR-1', typeId: 'decision', title: 'A decision', body: '' },
  { id: 'TICKET-1', typeId: 'ticket', title: 'Work', body: '- [ ] a step' },
  { id: 'NFR-1', typeId: 'nfr', title: 'A custom type', body: '' },
  { id: 'TASK-1', typeId: 'task', title: 'Custom work', body: '' },
];
const doc: RequirementsDocument = {
  itemTypes: [
    ...BUILT_IN_ITEM_TYPES,
    {
      id: 'nfr',
      label: 'Quality',
      prefix: 'NFR',
      color: '#fff',
      isWorkable: false,
      isBuiltIn: false,
    },
    {
      id: 'task',
      label: 'Task',
      prefix: 'TASK',
      color: '#fff',
      isWorkable: true,
      isBuiltIn: false,
    },
  ],
  categories: [],
  items,
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  relationships: [],
  nextSequence: {},
};
const byId = (id: string) => items.find((i) => i.id === id)!;
const context = { doc, existingSprintIds: new Set<string>() };

console.log('\n=== What gets verified ===');
assert(isVerifiable(doc, byId('REQ-1')), 'a requirement');
assert(isVerifiable(doc, byId('CON-1')), 'a constraint');
assert(!isVerifiable(doc, byId('GOAL-1')), 'not a goal');
assert(!isVerifiable(doc, byId('ADR-1')), 'not a decision');
assert(!isVerifiable(doc, byId('TICKET-1')), 'not a ticket');
assert(isVerifiable(doc, byId('NFR-1')), "a team's own descriptive type");
assert(!isVerifiable(doc, byId('TASK-1')), "but not a team's own work type");

console.log('\n=== Status ===');
assert(
  getVerificationStatusMeta(undefined).id === 'not-verified',
  'no status reads as not verified',
);
assert(
  isVerified(byId('REQ-1')) && !isVerified(byId('REQ-2')) && !isVerified(byId('CON-1')),
  'only passing counts as verified',
);
assert(describeVerification(byId('REQ-1')) === 'Test - Verified', 'described with its method');
assert(describeVerification(byId('CON-1')) === 'Not verified', 'or without one');

console.log('\n=== Gaps and coverage ===');
{
  const having = (gap: 'not-verified' | 'no-acceptance-criteria') =>
    items
      .filter((i) => itemHasGap(i, gap, context))
      .map((i) => i.id)
      .join();
  assert(having('not-verified') === 'REQ-2,CON-1,NFR-1', 'not verified: failing or never checked');
  assert(
    having('no-acceptance-criteria') === 'CON-1,NFR-1',
    'no acceptance criteria: verifiable items only, so not the goal or the ticket',
  );
  assert(
    items.filter((i) => itemMatchesFilter(i, { gaps: ['not-verified'] }, context)).length === 3,
    'the filter narrows to them',
  );
  assert(
    normalizeFilter({ gaps: ['not-verified', 'no-acceptance-criteria'] }).gaps?.length === 2,
    'and a stored filter keeps both',
  );
  const c = computeCoverage(doc, new Set());
  assert(
    c.verifiable === 4 && c.verified === 1 && c.withCriteria === 2,
    'coverage counts all three',
  );
}

console.log('\n=== Export ===');
{
  const md = toMarkdownDocument('T', doc);
  assert(md.includes('*Verification: Test - Verified*'), 'a requirement carries its verification');
  assert(md.includes('*Verification: Not verified*'), 'including one never checked');
  assert((md.match(/\*Verification:/g) ?? []).length === 4, 'and nothing else does');
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
    seeded?.verificationMethod === 'test' && seeded.verificationStatus === 'passing',
    'seeding from a file keeps both verification fields',
  );
  assert(
    find(ydoc, 'CON-1')?.verificationStatus === undefined,
    'and adds none where there were none',
  );

  // Two people, one choosing the method and one the status, both keep
  // their change - the reason they are separate fields.
  const peerA = new Y.Doc();
  const peerB = new Y.Doc();
  Y.applyUpdate(peerA, Y.encodeStateAsUpdate(ydoc));
  Y.applyUpdate(peerB, Y.encodeStateAsUpdate(ydoc));
  createYjsRequirementsStore(peerA).updateItem('CON-1', { verificationMethod: 'inspection' });
  createYjsRequirementsStore(peerB).updateItem('CON-1', { verificationStatus: 'failing' });
  Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB));
  const merged = find(peerA, 'CON-1');
  assert(
    merged?.verificationMethod === 'inspection' && merged.verificationStatus === 'failing',
    'a method chosen by one person and a status by another both survive the merge',
  );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
