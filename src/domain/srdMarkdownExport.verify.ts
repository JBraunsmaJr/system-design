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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
} else {
  console.log('All srdMarkdownExport tests passed successfully!\n');
}
