/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/SrdPrintModal.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { SrdPrintModal } from './SrdPrintModal';
import type { SrdDataContext } from '../../domain/srd/srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const mockSrdData: SrdDataContext = {
  metadata: {
    title: 'Core Architecture SRD',
    description: 'System requirement and architecture specification.',
    generatedAt: '2026-09-26',
    version: '1.0.0',
    authors: [{ name: 'Alice Smith', role: 'Chief Architect' }],
    organization: 'Acme Technologies',
  },
  branding: {
    primaryColor: '#1e3a8a',
    secondaryColor: '#475569',
    accentColor: '#0ea5e9',
    fontFamily: 'Inter',
  },
  headersAndFooters: {
    classificationBanner: 'CONFIDENTIAL — INTERNAL USE ONLY',
    headerLeft: '{{metadata.title}}',
    headerRight: 'Doc Ver: {{metadata.version}}',
    footerLeft: '© {{metadata.organization}}',
    footerRight: 'Page {{pageNumber}} of {{totalPages}}',
  },
  architecture: {
    components: [
      {
        id: 'c1',
        name: 'API Gateway',
        type: 'Gateway',
        description: 'Routes incoming traffic',
        status: 'active',
      },
    ],
    connections: [{ from: 'c1', to: 'c2', label: 'HTTP / REST' }],
  },
  requirements: {
    categories: [{ id: 'cat1', label: 'Security', color: '#10b981' }],
    itemsByCategory: {
      cat1: [
        {
          id: 'REQ-1',
          typeId: 'req',
          typeLabel: 'Requirement',
          title: 'OAuth Authentication',
          body: '',
          status: 'done',
          points: 5,
        },
      ],
    },
    summaryStats: {
      total: 1,
      completed: 1,
      inProgress: 0,
      totalPoints: 5,
      completedPoints: 5,
    },
  },
  traceability: [
    {
      sourceId: 'REQ-1',
      sourceTitle: 'OAuth Authentication',
      relation: 'implemented-by',
      targetId: 'c1',
      targetTitle: 'API Gateway',
    },
  ],
  roadmap: {
    milestones: [
      {
        id: 'm1',
        title: 'Beta Release',
        targetDate: '2026-12-01',
        status: 'planned',
        type: 'Release',
      },
    ],
    sprints: [
      {
        id: 's1',
        piName: 'PI-1',
        name: 'Sprint 1',
        startDate: '2026-10-01',
        endDate: '2026-10-14',
        totalPoints: 5,
        assignedItems: ['REQ-1'],
      },
    ],
    epicSchedules: [],
  },
};

// 1. SrdPrintModal renders preview containers for running header, document content, and footer
{
  const html = renderToStaticMarkup(
    <SrdPrintModal isOpen={true} onClose={() => {}} srdData={mockSrdData} />,
  );

  assert(html.includes('srd-preview-paper'), 'Renders preview paper wrapper');
  assert(html.includes('srd-doc__running-header-container'), 'Renders running header container');
  assert(html.includes('Core Architecture SRD'), 'Renders header text');
  assert(html.includes('srd-doc__content-container'), 'Renders document content container');
  assert(html.includes('srd-doc__footer-container'), 'Renders footer container');
  assert(html.includes('srd-doc__footer'), 'Renders footer content');
  assert(html.includes('Acme Technologies'), 'Renders organization metadata');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
