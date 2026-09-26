/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srdDataAggregator.verify.ts
 */
import type { Node, Edge } from '@xyflow/react';
import type { RequirementsDocument } from './requirementsTypes';
import type { Milestone } from './milestones';
import type { ProgramIncrement } from './programIncrements';
import type { TeamDocument } from './teamTypes';
import { aggregateSrdData } from './srdDataAggregator';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error(`FAIL: ${message}`);
  }
}

console.log('Testing SRD Data Aggregator...');

const mockDoc: RequirementsDocument = {
  itemTypes: [
    { id: 'req', label: 'Requirement', prefix: 'REQ', color: '#3b82f6', isBuiltIn: true, isWorkable: false },
    { id: 'epic', label: 'Epic', prefix: 'EPIC', color: '#8b5cf6', isBuiltIn: true, isWorkable: false },
    { id: 'task', label: 'Task', prefix: 'TSK', color: '#10b981', isBuiltIn: true, isWorkable: true },
  ],
  categories: [
    { id: 'cat-auth', label: 'Authentication', color: '#6366f1' },
    { id: 'cat-core', label: 'Core Engine', color: '#ec4899' },
  ],
  items: [
    { id: 'REQ-1', typeId: 'req', title: 'User Login Support', body: 'Must support OAuth2', categoryId: 'cat-auth' },
    { id: 'EPIC-1', typeId: 'epic', title: 'Core Security', body: 'Security epic', categoryId: 'cat-auth' },
    { id: 'TSK-1', typeId: 'task', title: 'Implement JWT validation', body: 'Token checks', categoryId: 'cat-auth', sprintId: 'sprint-1', points: 5, status: 'done', assigneeId: 'member-1' },
    { id: 'TSK-2', typeId: 'task', title: 'Rate Limiter', body: 'Redis based', categoryId: 'cat-core', sprintId: 'sprint-1', points: 3, status: 'in-progress' },
    { id: 'TSK-3', typeId: 'task', title: 'Audit Logger', body: 'Structured logs', categoryId: 'cat-core', points: 2, status: 'todo' },
  ],
  relationshipTypes: [
    { id: 'blocks', label: 'Blocks', inverseLabel: 'Is blocked by', color: '#ef4444', isBuiltIn: true, isBlocking: true },
    { id: 'parent-of', label: 'Parent of', inverseLabel: 'Child of', color: '#8b5cf6', isBuiltIn: true, isBlocking: false },
  ],
  relationships: [
    { id: 'rel-1', typeId: 'parent-of', fromItemId: 'EPIC-1', toItemId: 'TSK-1' },
    { id: 'rel-2', typeId: 'blocks', fromItemId: 'TSK-1', toItemId: 'TSK-2' },
  ],
  nextSequence: { REQ: 2, EPIC: 2, TSK: 4 },
};

const mockNodes: Node[] = [
  {
    id: 'node-auth',
    type: 'typed',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'service',
      label: 'Auth Service',
      description: 'Handles OAuth2 authentication and token issuance',
      linkedRequirementIds: ['REQ-1', 'TSK-1'],
    },
  },
  {
    id: 'node-db',
    type: 'typed',
    position: { x: 200, y: 0 },
    data: {
      nodeType: 'database',
      label: 'PostgreSQL DB',
      description: 'Primary datastore',
    },
  },
];

const mockEdges: Edge[] = [
  {
    id: 'edge-1',
    source: 'node-auth',
    target: 'node-db',
    data: {
      label: 'Store user sessions',
      edgeType: 'tcp',
    },
  },
];

const mockMilestones: Milestone[] = [
  {
    id: 'ms-1',
    name: 'v1.0 Beta Release',
    scheduledAt: '2026-10-15',
    type: 'release',
    description: 'First public beta',
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
    relatedItemIds: ['TSK-1'],
  },
];

const mockPIs: ProgramIncrement[] = [
  {
    id: 'pi-1',
    name: 'PI 1',
    startDate: '2026-10-01',
    sprints: [
      { id: 'sprint-1', name: 'Sprint 1', durationDays: 14 },
    ],
  },
];

const mockTeam: TeamDocument = {
  members: [
    { id: 'member-1', name: 'Alice Engineer', role: 'Lead Architect', ptoSpans: [] },
  ],
  settings: { defaultPointsPerDay: 1, excludeUsHolidays: true, extraDaysOff: [] },
};

// --- Test 1: Aggregation & Summary Stats ---
{
  const srdData = aggregateSrdData({
    title: 'Identity Platform SRD',
    nodes: mockNodes,
    edges: mockEdges,
    doc: mockDoc,
    milestones: mockMilestones,
    programIncrements: mockPIs,
    teamDoc: mockTeam,
  });

  assert(srdData.metadata.title === 'Identity Platform SRD', 'Title matches input');
  assert(srdData.metadata.authors[0].name === 'Alice Engineer', 'Author mapped from teamDoc');
  assert(srdData.architecture.components.length === 2, 'Component count matches nodes');
  assert(srdData.architecture.connections.length === 1, 'Connection count matches edges');
  assert(srdData.architecture.connections[0].fromName === 'Auth Service', 'Resolved source node name');
  assert(srdData.architecture.connections[0].toName === 'PostgreSQL DB', 'Resolved target node name');

  const stats = srdData.requirements.summaryStats;
  assert(stats.total === 5, 'Total requirements is 5');
  assert(stats.completed === 1, '1 task completed');
  assert(stats.inProgress === 1, '1 task in progress');
  assert(stats.totalPoints === 10, 'Total points = 5 + 3 + 2 = 10');
  assert(stats.completedPoints === 5, 'Completed points = 5');

  console.log('✓ Test 1: Aggregation and summary stats passed');
}

// --- Test 1b: Custom Organization & Metadata Overrides ---
{
  const srdData = aggregateSrdData({
    title: 'Acme Architecture SRD',
    nodes: mockNodes,
    edges: mockEdges,
    doc: mockDoc,
    metadataOverrides: {
      organization: 'Acme Corp Labs',
      version: '2.1.0',
    },
  });

  assert(srdData.metadata.organization === 'Acme Corp Labs', 'Custom organization override respected');
  assert(srdData.metadata.version === '2.1.0', 'Custom version override respected');
  assert(Boolean(srdData.headersAndFooters.footerLeft?.includes('Acme Corp Labs')), 'Organization reflected in footer default');

  console.log('✓ Test 1b: Metadata overrides passed');
}

// --- Test 2: Traceability Matrix with cross-node and cross-requirement links ---
{
  const srdData = aggregateSrdData({
    title: 'Traceability Test',
    nodes: mockNodes,
    edges: mockEdges,
    doc: mockDoc,
    milestones: mockMilestones,
    programIncrements: mockPIs,
  });

  assert(srdData.traceability.length === 4, 'Traceability matrix contains 2 requirement rels + 2 node req links');
  const reqRel = srdData.traceability.find((t) => t.sourceId === 'TSK-1' && t.targetId === 'TSK-2');
  assert(reqRel !== undefined && reqRel.relation === 'Blocks', 'Requirement relation mapped');

  const nodeRel = srdData.traceability.find((t) => t.sourceId === 'node-auth' && t.targetId === 'REQ-1');
  assert(nodeRel !== undefined && nodeRel.relation === 'Implements / Satisfies', 'Node to requirement link mapped');

  console.log('✓ Test 2: Traceability matrix passed');
}

// --- Test 3: Roadmap Sprints & Inferred Epic Schedules ---
{
  const srdData = aggregateSrdData({
    title: 'Roadmap Test',
    nodes: mockNodes,
    edges: mockEdges,
    doc: mockDoc,
    milestones: mockMilestones,
    programIncrements: mockPIs,
  });

  assert(srdData.roadmap.sprints.length === 1, 'Sprint list mapped');
  assert(srdData.roadmap.sprints[0].totalPoints === 8, 'Sprint 1 points = 5 + 3 = 8');
  assert(srdData.roadmap.sprints[0].assignedItems.includes('TSK-1'), 'Sprint 1 includes TSK-1');
  assert(srdData.roadmap.sprints[0].assignedItems.includes('TSK-2'), 'Sprint 1 includes TSK-2');

  assert(srdData.roadmap.epicSchedules.length === 1, 'Epic schedule computed');
  assert(srdData.roadmap.epicSchedules[0].epicId === 'EPIC-1', 'Epic schedule has EPIC-1');
  assert(srdData.roadmap.epicSchedules[0].epicTitle === 'Core Security', 'Epic title is Core Security');

  console.log('✓ Test 3: Roadmap sprints and epic schedule passed');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
} else {
  console.log('All srdDataAggregator tests passed successfully!\n');
}
