/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srdMarkdownExport.verify.ts
 */
import { generateSrdMarkdown, interpolateTokens } from './srdMarkdownExport';
import { aggregateSrdData } from './srdDataAggregator';
import {
  ENTERPRISE_FORMAL_TEMPLATE,
  AGILE_ENGINEERING_TEMPLATE,
} from './srdTemplatePresets';
import type { RequirementsDocument } from './requirementsTypes';

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

console.log('Testing SRD Markdown Exporter...');

const mockDoc: RequirementsDocument = {
  itemTypes: [
    { id: 'req', label: 'Requirement', prefix: 'REQ', color: '#3b82f6', isBuiltIn: true, isWorkable: false },
    { id: 'task', label: 'Task', prefix: 'TSK', color: '#10b981', isBuiltIn: true, isWorkable: true },
  ],
  categories: [
    { id: 'cat-auth', label: 'Authentication', color: '#6366f1' },
  ],
  items: [
    { id: 'REQ-1', typeId: 'req', title: 'OAuth2 Authentication', body: 'Supports SSO via Google/GitHub', categoryId: 'cat-auth' },
    { id: 'TSK-1', typeId: 'task', title: 'Issue JWT Tokens', body: 'RS256 algorithm', categoryId: 'cat-auth', points: 5, status: 'done' },
  ],
  relationshipTypes: [
    { id: 'relates-to', label: 'Relates to', inverseLabel: 'Relates to', color: '#3b82f6', isBuiltIn: true, isBlocking: false },
  ],
  relationships: [
    { id: 'r1', typeId: 'relates-to', fromItemId: 'REQ-1', toItemId: 'TSK-1' },
  ],
  nextSequence: { REQ: 2, TSK: 2 },
};

const srdData = aggregateSrdData({
  title: 'Secure Gateway SRD',
  doc: mockDoc,
  nodes: [
    {
      id: 'gw-node',
      type: 'typed',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'service',
        label: 'API Gateway',
        description: 'Entry gateway for API clients',
        linkedRequirementIds: ['REQ-1'],
      },
    },
  ],
  edges: [],
  milestones: [
    {
      id: 'm1',
      name: 'Alpha Launch',
      scheduledAt: '2026-11-01',
      type: 'release',
      description: 'Alpha release',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      relatedItemIds: ['TSK-1'],
    },
  ],
  programIncrements: [
    {
      id: 'pi1',
      name: 'PI 1',
      startDate: '2026-10-01',
      sprints: [{ id: 'sp1', name: 'Sprint 1', durationDays: 14 }],
    },
  ],
});

// --- Test 1: Enterprise Formal Template Markdown Output ---
{
  const md = generateSrdMarkdown(srdData, ENTERPRISE_FORMAL_TEMPLATE);

  assert(md.includes('# Secure Gateway SRD'), 'Includes title');
  assert(md.includes('> **CONFIDENTIAL — INTERNAL USE ONLY**'), 'Includes classification banner');
  assert(md.includes('## 1. Executive Summary'), 'Includes Section 1');
  assert(md.includes('## 2. System Architecture & High-Level Design'), 'Includes Section 2');
  assert(md.includes('API Gateway'), 'Includes architecture component');
  assert(md.includes('## 3. Requirements & Constraints Specification'), 'Includes Section 3');
  assert(md.includes('OAuth2 Authentication'), 'Includes requirement item');
  assert(md.includes('## 4. Traceability & Dependency Matrix'), 'Includes Section 4');
  assert(md.includes('## 5. Delivery Roadmap & Program Increments'), 'Includes Section 5');
  assert(md.includes('Alpha Launch'), 'Includes milestone in roadmap');

  console.log('✓ Test 1: Enterprise Formal Markdown output passed');
}

// --- Test 2: Agile Engineering Template Order & Filtering ---
{
  const md = generateSrdMarkdown(srdData, AGILE_ENGINEERING_TEMPLATE);

  assert(md.includes('> **ENGINEERING SPECIFICATION**'), 'Agile banner present');
  assert(md.includes('## System Architecture & Services'), 'Architecture section rendered');
  assert(md.includes('## Work Items & Backlog Requirements'), 'Requirements section rendered');
  assert(!md.includes('## Executive Summary'), 'Disabled executive summary section omitted');

  console.log('✓ Test 2: Agile Engineering template ordering passed');
}

// --- Test 3: Macro Token Replacement ---
{
  const result = interpolateTokens('Doc: {{title}} | Ver: {{version}} | Org: {{organization}}', srdData);
  assert(result === 'Doc: Secure Gateway SRD | Ver: 1.0 | Org: Engineering Organization', 'Interpolates all tokens');

  console.log('✓ Test 3: Token interpolation passed');
}

// --- Test 4: Dual Requirements Rendering (List vs Table) & Snapshots ---
{
  const dataWithSnapshots = {
    ...srdData,
    requirements: {
      ...srdData.requirements,
      itemsByCategory: {
        ...srdData.requirements.itemsByCategory,
        'cat-auth': srdData.requirements.itemsByCategory['cat-auth'].map((it) =>
          it.id === 'REQ-1'
            ? { ...it, contextSnapshotBase64: 'data:image/png;base64,mockSnap123' }
            : it,
        ),
      },
    },
  };

  // 4a. List view
  const mdList = generateSrdMarkdown(dataWithSnapshots, {
    ...AGILE_ENGINEERING_TEMPLATE,
    requirementsLayout: 'list',
  });
  assert(mdList.includes('#### REQ-1: OAuth2 Authentication'), 'List view renders H4 item headers');
  assert(mdList.includes('![Architecture Context for REQ-1](data:image/png;base64,mockSnap123)'), 'List view embeds context snapshot');
  assert(mdList.includes('*Dependencies & Links:*'), 'List view renders dependency links');

  // 4b. Table view
  const mdTable = generateSrdMarkdown(dataWithSnapshots, {
    ...AGILE_ENGINEERING_TEMPLATE,
    requirementsLayout: 'table',
  });
  assert(mdTable.includes('| ID | Title | Type | Status | Points | Sprint | Assignee |'), 'Table view renders GFM table header');
  assert(mdTable.includes('| `REQ-1` | **OAuth2 Authentication** |'), 'Table view renders row');

  // 4c. Component Inventory Table toggle
  const mdWithCompTable = generateSrdMarkdown(srdData, {
    ...ENTERPRISE_FORMAL_TEMPLATE,
    includeComponentTable: true,
  });
  assert(mdWithCompTable.includes('### Component Inventory'), 'Component inventory included when enabled');

  const mdWithoutCompTable = generateSrdMarkdown(srdData, {
    ...ENTERPRISE_FORMAL_TEMPLATE,
    includeComponentTable: false,
  });
  assert(!mdWithoutCompTable.includes('### Component Inventory'), 'Component inventory omitted when disabled');

  // 4d. Connections & Protocols Table toggle
  const mdWithConnTable = generateSrdMarkdown(srdData, {
    ...ENTERPRISE_FORMAL_TEMPLATE,
    includeConnectionsTable: true,
  });
  assert(mdWithConnTable.includes('### Connections & Protocols'), 'Connections table included when enabled');

  const mdWithoutConnTable = generateSrdMarkdown(srdData, {
    ...ENTERPRISE_FORMAL_TEMPLATE,
    includeConnectionsTable: false,
  });
  assert(!mdWithoutConnTable.includes('### Connections & Protocols'), 'Connections table omitted when disabled');

  console.log('✓ Test 4: Dual layouts, snapshot embeds, component and connections table toggles passed');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
} else {
  console.log('All srdMarkdownExport tests passed successfully!\n');
}
