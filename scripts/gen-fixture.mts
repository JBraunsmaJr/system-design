/**
 * Generates a schema fixture using THIS checkout's own serialization code.
 *
 * Run from inside a worktree of a historical commit. `toDiagramFile` gained
 * one parameter per schema version and its signature is purely additive, so we
 * pass the full superset positionally - older versions ignore the tail.
 *
 * Never hand-author these fixtures. The point is to capture what each version
 * actually wrote, not what we currently believe it wrote.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import * as serialization from './src/domain/serialization';

const FIXED_DATE = '2026-01-01T00:00:00.000Z';

const node = (
  id: string,
  nodeType: string,
  label: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  type: 'typed',
  position: { x, y },
  data: {
    nodeType,
    label,
    description: `${label} description`,
    properties: { owner: 'platform-team', tier: '1' },
    tags: ['fixture'],
    ...extra,
  },
});

// Level 2 of the sub-diagram tree (nested inside level 1).
const level2 = {
  nodes: [node('l2-a', 'service', 'Token Validator', 40, 40)],
  edges: [],
};

// Level 1, itself nested inside the top-level auth node.
const level1 = {
  nodes: [
    node('l1-a', 'service', 'Credential Store', 40, 40, { subDiagram: level2 }),
    node('l1-b', 'database', 'Session Cache', 260, 40),
  ],
  edges: [{ id: 'l1-e1', source: 'l1-a', target: 'l1-b', data: { label: 'reads' } }],
};

const nodes = [
  node('n-gateway', 'service', 'API Gateway', 0, 0, {
    color: '#4f46e5',
    zIndex: 2,
  }),
  // Three levels deep, exercising WS5-R9 (lossless flattening).
  node('n-auth', 'service', 'Auth Service', 240, 0, {
    subDiagram: level1,
    hasSubDiagram: true,
  }),
  node('n-db', 'database', 'Primary Postgres', 480, 0),
  node('n-note', 'text', 'Fixture annotation', 0, 200, {
    textColor: '#111827',
    fontSize: 14,
  }),
  node('n-boundary', 'group', 'Trust Boundary', -40, -60),
];

const edges = [
  {
    id: 'e1',
    source: 'n-gateway',
    target: 'n-auth',
    data: { label: 'authenticates', edgeType: 'sync' },
  },
  {
    id: 'e2',
    source: 'n-auth',
    target: 'n-db',
    data: { label: 'persists', edgeType: 'async' },
  },
];

const scenarios = [
  {
    id: 's1',
    title: 'Login flow',
    steps: [
      {
        id: 's1-1',
        title: 'Request arrives',
        narration: 'Client hits the gateway',
        path: [],
        focusNodeIds: ['n-gateway'],
        focusEdgeIds: [],
      },
      {
        id: 's1-2',
        title: 'Validate',
        path: [],
        focusNodeIds: ['n-auth'],
        focusEdgeIds: ['e1'],
      },
      // Exercises a step that navigates into a nested sub-diagram.
      {
        id: 's1-3',
        title: 'Check credentials',
        path: ['n-auth'],
        focusNodeIds: ['l1-a'],
        focusEdgeIds: ['l1-e1'],
      },
    ],
  },
];

const requirements = {
  itemTypes: [
    {
      id: 'type-req',
      label: 'Requirement',
      prefix: 'REQ',
      color: '#7c3aed',
      isBuiltIn: true,
      isWorkable: false,
    },
    {
      id: 'type-ticket',
      label: 'Ticket',
      prefix: 'TICKET',
      color: '#2563eb',
      isBuiltIn: true,
      isWorkable: true,
    },
  ],
  categories: [{ id: 'cat-sec', label: 'Security', color: '#dc2626' }],
  items: [
    {
      id: 'REQ-1',
      typeId: 'type-req',
      title: 'Authentication overhaul',
      body: 'Replace the legacy session mechanism. See #TICKET-1.',
      categoryId: 'cat-sec',
    },
    {
      id: 'TICKET-1',
      typeId: 'type-ticket',
      title: 'Token validation at the gateway',
      body: 'Validate tokens before routing.',
      categoryId: 'cat-sec',
      sprintId: 'sp-1',
      assigneeId: 'm-1',
      points: 5,
      status: 'in-progress',
    },
  ],
  relationshipTypes: [
    {
      id: 'rt-blocks',
      label: 'Blocks',
      inverseLabel: 'Is blocked by',
      color: '#ef4444',
      isBuiltIn: true,
      isDependency: true,
    },
  ],
  relationships: [
    {
      id: 'rel-1',
      typeId: 'rt-blocks',
      fromItemId: 'REQ-1',
      toItemId: 'TICKET-1',
    },
  ],
  nextSequence: { 'type-req': 2, 'type-ticket': 2 },
};

const programIncrements = [
  {
    id: 'pi-1',
    name: 'PI 2026.1',
    // Sprint dates are always derived from this plus cumulative durations -
    // never stored per sprint. See programIncrements.ts.
    startDate: '2026-01-06',
    sprints: [
      { id: 'sp-1', name: 'Sprint 1', durationDays: 14 },
      { id: 'sp-2', name: 'Sprint 2', durationDays: 14 },
    ],
    reservations: [
      {
        id: 'cr-1',
        name: 'Risk buffer',
        unit: 'percentage',
        value: 20,
        category: 'risk',
      },
      {
        id: 'cr-2',
        name: 'Sprint 1 bug bash',
        unit: 'points',
        value: 5,
        sprintId: 'sp-1',
        category: 'bugs',
      },
    ],
  },
];

const team = {
  members: [
    {
      id: 'm-1',
      name: 'Fixture Engineer',
      role: 'Engineer',
      avatarColor: '#0ea5e9',
      defaultPointsPerDay: 1.5,
      ptoSpans: [
        {
          id: 'pto-1',
          startDate: '2026-01-08',
          endDate: '2026-01-09',
          startHalfDay: 'afternoon',
          endHalfDay: 'full',
          note: 'Appointment',
        },
      ],
    },
    {
      id: 'm-2',
      name: 'Second Member',
      ptoSpans: [],
    },
  ],
  settings: {
    defaultPointsPerDay: 1,
    excludeUsHolidays: true,
    extraDaysOff: [
      {
        id: 'edo-1',
        name: 'Company offsite',
        date: '2026-01-02',
        isHalfDay: false,
      },
    ],
  },
};

const milestones = [
  {
    id: 'ms-1',
    type: 'release',
    name: 'Auth GA',
    scheduledAt: '2026-03-31',
    version: '1.0.0',
    description: 'General availability',
    color: '#16a34a',
  },
];

const toDiagramFile = (serialization as Record<string, unknown>).toDiagramFile as (
  ...args: unknown[]
) => Record<string, unknown>;

const file = toDiagramFile(
  'Backward compatibility fixture',
  nodes,
  edges,
  scenarios,
  requirements,
  programIncrements,
  team,
  milestones,
);

// Pin the timestamp so fixtures are byte-stable across regeneration.
(file.metadata as Record<string, unknown>).updatedAt = FIXED_DATE;

const version = String(file.schemaVersion ?? 'unknown');
const outDir = process.env.FIXTURE_OUT ?? './fixtures';
mkdirSync(outDir, { recursive: true });
const path = `${outDir}/schema-${version}.json`;
writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
console.log(`${version}\t${path}\t${Object.keys(file).length} top-level fields`);
