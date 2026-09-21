/**
 * WS1-R6 — seeding must be safe to attempt twice.
 *
 * The failure this guards against is silent. Before this, a second seed pass
 * left every id in its ordering array twice while the maps held one entry
 * each, so the document rendered with duplicated nodes, duplicated
 * requirements and duplicated milestones, and nothing threw.
 *
 * It only became reachable once persistence restores a document before the
 * seed decision is made (WS2-R2), which is why it is pinned here rather than
 * left to the caller to remember.
 */
import * as Y from 'yjs';
import { seedYjsDiagramDoc, createYjsDiagramStore } from './yjsDiagramStore.ts';
import { seedYjsMilestonesDoc, createYjsMilestonesStore } from './yjsMilestonesStore.ts';
import {
  seedYjsProgramIncrementsDoc,
  createYjsProgramIncrementsStore,
} from './yjsProgramIncrementsStore.ts';
import { seedYjsRequirementsDoc, createYjsRequirementsStore } from './yjsRequirementsStore.ts';
import { createYjsTeamStore } from './yjsTeamStore.ts';
import { seedTeamStore } from './teamStore.ts';
import { isYjsDocEmpty, orderIdSet, pushIfAbsent } from './seedGuards.ts';
import type { SubDiagram } from '../domain/types';
import type { Milestone } from '../domain/milestones';
import type { ProgramIncrement } from '../domain/programIncrements';
import type { RequirementsDocument } from '../domain/requirementsTypes';
import type { TeamDocument } from '../domain/teamTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root: SubDiagram = {
  nodes: [
    {
      id: 'n1',
      type: 'typed',
      position: { x: 0, y: 0 },
      data: { nodeType: 'service', label: 'Gateway' },
    },
    {
      id: 'n2',
      type: 'typed',
      position: { x: 200, y: 0 },
      data: { nodeType: 'database', label: 'Postgres' },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'typed',
      data: { label: 'reads' },
    },
  ],
} as unknown as SubDiagram;

const milestones: Milestone[] = [
  { id: 'ms1', type: 'release', name: 'GA', scheduledAt: '2026-03-31' },
] as unknown as Milestone[];

const increments: ProgramIncrement[] = [
  {
    id: 'pi1',
    name: 'PI 1',
    startDate: '2026-01-06',
    sprints: [{ id: 'sp1', name: 'Sprint 1', durationDays: 14 }],
    reservations: [],
  },
] as unknown as ProgramIncrement[];

const requirements: RequirementsDocument = {
  itemTypes: [
    {
      id: 'type-req',
      label: 'Requirement',
      prefix: 'REQ',
      color: '#7c3aed',
      isBuiltIn: true,
      isWorkable: false,
    },
  ],
  categories: [{ id: 'cat1', label: 'Security', color: '#dc2626' }],
  items: [
    { id: 'REQ-1', typeId: 'type-req', title: 'Auth', body: '', categoryId: 'cat1' },
    { id: 'REQ-2', typeId: 'type-req', title: 'Audit', body: '', categoryId: 'cat1' },
  ],
  relationshipTypes: [],
  relationships: [],
  nextSequence: { 'type-req': 3 },
} as unknown as RequirementsDocument;

const team: TeamDocument = {
  members: [
    {
      id: 'm1',
      name: 'Engineer',
      defaultPointsPerDay: 1,
      ptoSpans: [{ id: 'pto1', startDate: '2026-01-08', endDate: '2026-01-08' }],
    },
  ],
  settings: {
    defaultPointsPerDay: 1,
    excludeUsHolidays: true,
    extraDaysOff: [{ id: 'edo1', name: 'Offsite', date: '2026-01-02' }],
  },
} as unknown as TeamDocument;

console.log('=== Emptiness check ===');
{
  const doc = new Y.Doc();
  assert(isYjsDocEmpty(doc), 'a fresh document reports empty');
  seedYjsDiagramDoc(doc, root);
  assert(!isYjsDocEmpty(doc), 'a seeded document does not report empty');
}

console.log('=== Seeding twice produces the same document ===');
{
  const doc = new Y.Doc();
  const seedAll = () => {
    seedYjsRequirementsDoc(doc, requirements);
    seedYjsProgramIncrementsDoc(doc, increments);
    seedYjsDiagramDoc(doc, root);
    seedYjsMilestonesDoc(doc, milestones);
    seedTeamStore(createYjsTeamStore(doc), team);
  };

  seedAll();
  const once = {
    nodes: createYjsDiagramStore(doc).getSnapshot(),
    milestones: createYjsMilestonesStore(doc).getSnapshot(),
    increments: createYjsProgramIncrementsStore(doc).getSnapshot(),
    requirements: createYjsRequirementsStore(doc).getSnapshot(),
    team: createYjsTeamStore(doc).getSnapshot(),
  };

  seedAll();
  const twice = {
    nodes: createYjsDiagramStore(doc).getSnapshot(),
    milestones: createYjsMilestonesStore(doc).getSnapshot(),
    increments: createYjsProgramIncrementsStore(doc).getSnapshot(),
    requirements: createYjsRequirementsStore(doc).getSnapshot(),
    team: createYjsTeamStore(doc).getSnapshot(),
  };

  assert(
    JSON.stringify(once.nodes) === JSON.stringify(twice.nodes),
    'the diagram is unchanged by a second seed',
  );
  assert(twice.milestones.length === milestones.length, 'milestones are not duplicated');
  assert(twice.increments.length === increments.length, 'program increments are not duplicated');
  assert(
    twice.requirements.items.length === requirements.items.length,
    'requirement items are not duplicated - these are keyed by a generated ' +
      'storage key, so presence has to be checked against the id inside',
  );
  assert(
    twice.requirements.itemTypes.length === requirements.itemTypes.length,
    'item types are not duplicated',
  );
  assert(
    twice.requirements.categories.length === requirements.categories.length,
    'categories are not duplicated',
  );
  assert(twice.team.members.length === 1, 'team members are not duplicated');
  assert(twice.team.members[0].ptoSpans.length === 1, 'PTO spans are not duplicated');
  assert(twice.team.settings.extraDaysOff.length === 1, 'extra days off are not duplicated');
}

console.log('=== Ordering arrays hold no duplicate ids ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  seedYjsDiagramDoc(doc, root);
  for (const name of ['nodeOrder', 'edgeOrder']) {
    const ids = doc.getArray<string>(name).toArray();
    assert(new Set(ids).size === ids.length, `${name} holds each id exactly once`);
  }
}

console.log('=== Seeding merges into a partially populated document ===');
{
  // The realistic restore case: persistence brought back some content, and
  // the seed carries content the restored copy does not have.
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, {
    ...root,
    nodes: [root.nodes[0]],
    edges: [],
  } as unknown as SubDiagram);
  seedYjsDiagramDoc(doc, root);

  const snapshot = createYjsDiagramStore(doc).getSnapshot();
  assert(snapshot.nodes.length === 2, 'the missing node is added');
  assert(snapshot.edges.length === 1, 'the missing edge is added');
  const ids = doc.getArray<string>('nodeOrder').toArray();
  assert(new Set(ids).size === ids.length, 'and the present one is not repeated');
}

console.log('=== pushIfAbsent ===');
{
  const doc = new Y.Doc();
  const order = doc.getArray<string>('probe');
  const seen = orderIdSet(order);
  assert(pushIfAbsent(order, seen, 'a'), 'a new id is appended');
  assert(!pushIfAbsent(order, seen, 'a'), 'a repeated id is rejected');
  assert(order.length === 1, 'the array holds one entry');

  const reloaded = orderIdSet(order);
  assert(!pushIfAbsent(order, reloaded, 'a'), 'a set rebuilt from the array sees the existing id');
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} seed idempotency check(s) failed`);
}
console.log('\nAll seed idempotency checks passed.');
